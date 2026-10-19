import {
    clientApi,
    deviceInfoApi,
    locationInfoApi,
    RingRestClient,
} from './rest-client.js'
import { Location } from './location.js'
import {
    PushNotificationAction,
    RingCameraKind,
    RingDeviceType,
} from './ring-types.js'
import { RingCamera } from './ring-camera.js'
import { RingChime } from './ring-chime.js'
import { combineLatest, EMPTY, merge, Subject } from 'rxjs'
import {
    debounceTime,
    startWith,
    switchMap,
    throttleTime,
} from 'rxjs/operators'
import {
    clearTimeouts,
    logDebug,
    logError,
    logInfo,
} from './util.js'
import { Subscribed } from './subscribed.js'
import { PushReceiver } from '@eneris/push-receiver'
import { RingIntercom } from './ring-intercom.js'
import JSONbig from 'json-bigint'

// The device_info api returns a single flat device list, so this client has to
// bucket the devices itself.  Kinds are matched by pattern rather than by exact
// enum membership so that new hardware revisions (stickup_cam_mini_v2,
// cocoa_doorbell_v4, chime_v3, ...) are still classified correctly before they
// have been added to RingCameraKind/ChimeModel.
const doorbellKindPattern = /^(doorbot|doorbell|lpd_|jbox_|cocoa_doorbell)/,
    chimeKindPattern = /^chime/,
    baseStationKindPattern = /^base_station/,
    beamBridgeKindPattern = /^beams_bridge/,
    intercomKindPattern = /^intercom_handset/

// Last resort for a kind this client has never seen: identify a camera from the
// shape of its payload.  These fields are only ever present on camera devices,
// never on chimes, base stations, beam bridges or intercom handsets.
function looksLikeCameraData(device) {
    const { night_mode_status: nightModeStatus, settings } = device
    return Boolean(
        nightModeStatus !== undefined ||
            (settings &&
                (settings.motion_zones !== undefined ||
                    settings.live_view_preset_profile !== undefined ||
                    settings.motion_snooze_preset_profile !== undefined)),
    )
}

export class RingApi extends Subscribed {
    restClient
    onRefreshTokenUpdated
    options

    constructor(options) {
        super()
        this.options = options
        this.restClient = new RingRestClient(this.options)
        this.onRefreshTokenUpdated =
            this.restClient.onRefreshTokenUpdated.asObservable()
        const { locationIds } = options
        if (locationIds && !locationIds.length) {
            logError(
                'Your Ring config has `"locationIds": []`, which means no locations will be used and no devices will be found.',
            )
        }
    }

    async fetchRingDevices() {
        const { devices, device_operation_sets: deviceOperationSets } =
                await this.restClient.request({
                    url: deviceInfoApi('devices'),
                }),
            doorbots = [],
            authorizedDoorbots = [],
            stickupCams = [],
            chimes = [],
            baseStations = [],
            beamBridges = [],
            onvifCameras = [],
            intercoms = [],
            thirdPartyGarageDoorOpeners = [],
            unknownDevices = []

        for (const device of devices) {
            // Resolve the operation set the device was tagged with into the list of
            // operations this account may perform on it.  Devices shared by another
            // account can be limited to a subset (no device_alerts_manage, for
            // example, which is required to subscribe to ding/motion notifications)
            const kind = device.kind,
                operationSet = device.operation_set
            if (operationSet && deviceOperationSets?.[operationSet]) {
                device.operations = Object.keys(
                    deviceOperationSets[operationSet],
                )
            }
            // Non-camera devices are matched first so that the payload based camera
            // fallback below can never claim one of them
            if (chimeKindPattern.test(kind)) {
                chimes.push(device)
            } else if (baseStationKindPattern.test(kind)) {
                baseStations.push(device)
            } else if (beamBridgeKindPattern.test(kind)) {
                beamBridges.push(device)
            } else if (intercomKindPattern.test(kind)) {
                intercoms.push(device)
            } else if (kind === RingDeviceType.ThirdPartyGarageDoorOpener) {
                thirdPartyGarageDoorOpeners.push(device)
            } else if (kind === RingDeviceType.OnvifCamera) {
                onvifCameras.push(device)
            } else {
                const isDoorbell = doorbellKindPattern.test(kind),
                    isKnownCameraKind = kind in RingCameraKind
                if (
                    isDoorbell ||
                    isKnownCameraKind ||
                    looksLikeCameraData(device)
                ) {
                    if (!isKnownCameraKind) {
                        // Still fully usable, but the model name and any kind specific
                        // behavior fall back to defaults until the kind is added
                        logInfo(
                            `Camera "${device.description}" has unknown kind "${kind}", using generic camera support`,
                        )
                    }
                    if (isDoorbell && device.owned === false) {
                        authorizedDoorbots.push(device)
                    } else if (isDoorbell) {
                        doorbots.push(device)
                    } else {
                        stickupCams.push(device)
                    }
                } else {
                    logDebug(
                        `Ignoring unsupported device "${device.description}" of kind "${kind}"`,
                    )
                    unknownDevices.push(device)
                }
            }
        }
        return {
            doorbots,
            chimes,
            authorizedDoorbots,
            stickupCams,
            allCameras: [
                ...doorbots,
                ...stickupCams,
                ...authorizedDoorbots,
                ...onvifCameras,
            ],
            baseStations,
            beamBridges,
            onvifCameras,
            thirdPartyGarageDoorOpeners,
            intercoms,
            unknownDevices,
        }
    }

    listenForDeviceUpdates(cameras, chimes, intercoms) {
        const { cameraStatusPollingSeconds } = this.options
        if (!cameraStatusPollingSeconds) {
            return
        }
        const devices = [...cameras, ...chimes, ...intercoms],
            onDeviceRequestUpdate = merge(
                ...devices.map((device) => device.onRequestUpdate),
            ),
            onUpdateReceived = new Subject(),
            onPollForStatusUpdate = cameraStatusPollingSeconds
                ? onUpdateReceived.pipe(
                      debounceTime(cameraStatusPollingSeconds * 1000),
                  )
                : EMPTY,
            camerasById = cameras.reduce((byId, camera) => {
                byId[camera.id] = camera
                return byId
            }, {}),
            chimesById = chimes.reduce((byId, chime) => {
                byId[chime.id] = chime
                return byId
            }, {}),
            intercomsById = intercoms.reduce((byId, intercom) => {
                byId[intercom.id] = intercom
                return byId
            }, {})
        if (!cameras.length && !chimes.length && !intercoms.length) {
            return
        }
        this.addSubscriptions(
            merge(onDeviceRequestUpdate, onPollForStatusUpdate)
                .pipe(
                    throttleTime(500),
                    switchMap(() => this.fetchRingDevices().catch(() => null)),
                )
                .subscribe((response) => {
                    onUpdateReceived.next(null)
                    if (!response) {
                        return
                    }
                    response.allCameras.forEach((data) => {
                        const camera = camerasById[data.id]
                        if (camera) {
                            camera.updateData(data)
                        }
                    })
                    response.chimes.forEach((data) => {
                        const chime = chimesById[data.id]
                        if (chime) {
                            chime.updateData(data)
                        }
                    })
                    response.intercoms.forEach((data) => {
                        const intercom = intercomsById[data.id]
                        if (intercom) {
                            intercom.updateData(data)
                        }
                    })
                }),
        )
        if (cameraStatusPollingSeconds) {
            onUpdateReceived.next(null) // kick off polling
        }
    }

    async registerPushReceiver(cameras, intercoms) {
        const credentials =
                this.restClient._internalOnly_pushNotificationCredentials
                    ?.config &&
                this.restClient._internalOnly_pushNotificationCredentials,
            pushReceiver = new PushReceiver({
                firebase: {
                    apiKey: 'AIzaSyCv-hdFBmmdBBJadNy-TFwB-xN_H5m3Bk8',
                    projectId: 'ring-17770',
                    messagingSenderId: '876313859327', // for Ring android app.  703521446232 for ring-site
                    appId: '1:876313859327:android:e10ec6ddb3c81f39',
                },
                credentials,
                debug: false,
            }),
            devicesById = {},
            sendToDevice = (id, notification) => {
                devicesById[id]?.processPushNotification(notification)
            },
            onPushNotificationToken = new Subject()

        for (const camera of cameras) {
            devicesById[camera.id] = camera
        }
        for (const intercom of intercoms) {
            devicesById[intercom.id] = intercom
        }
        pushReceiver.onCredentialsChanged(({ newCredentials }) => {
            // Store the new credentials in the rest client so that it can be used for subsequent restarts
            this.restClient._internalOnly_pushNotificationCredentials =
                newCredentials
            // Send the new credentials to the server
            onPushNotificationToken.next(newCredentials.fcm.token)
        })
        this.addSubscriptions(
            combineLatest([
                onPushNotificationToken,
                this.restClient.onSession.pipe(startWith(undefined)), // combined but not used here, just to trigger another request when session is updated
            ]).subscribe(async ([token]) => {
                try {
                    await this.restClient.request({
                        url: clientApi('device'),
                        method: 'PATCH',
                        json: {
                            device: {
                                metadata: {
                                    ...this.restClient.baseSessionMetadata,
                                    pn_dict_version: '2.4.0',
                                    pn_service: 'fcm',
                                },
                                os: 'android',
                                push_notification_token: token,
                            },
                        },
                    })
                } catch (e) {
                    logError(e)
                }
            }),
        )
        pushReceiver.on('ON_DISCONNECT', () => {
            pushReceiver.whenReady.catch((e) => {
                logError(
                    'Connection to the push notification server has failed unexpectedly',
                )
                logError(
                    'If this happens repeatedly, verify connections to TCP/5228 are not blocked by firewall or IDS/IPS policies, and that DNS Adblock rules allow mtalk.google.com',
                )
                logError(e.message)
            })
        })
        try {
            await pushReceiver.connect()
        } catch (e) {
            logError('Failed to connect push notification receiver')
            logError(e)
        }
        const startTime = Date.now()
        pushReceiver.onNotification(({ message }) => {
            // Ignore messages received in the first two seconds after connecting
            // These are likely duplicates, and we aren't currently storying persistent ids anywhere to avoid re-processing them
            if (Date.now() - startTime < 2000) {
                logInfo(
                    'Ignoring push notification received in first two seconds after starting up',
                )
                return
            }
            try {
                const messageData = {}
                // Each message field is a JSON string, so we need to parse them each individually
                for (const p in message.data) {
                    try {
                        // If it's a JSON string, parse it into an object
                        messageData[p] = JSONbig({
                            storeAsString: true,
                        }).parse(message.data[p])
                    } catch {
                        // Otherwise just assign the value directly
                        messageData[p] = message.data[p]
                    }
                }
                const notification = messageData
                if ('android_config' in notification) {
                    const deviceId = notification.data?.device?.id
                    if (deviceId) {
                        sendToDevice(deviceId, notification)
                        logDebug(JSON.stringify(notification))
                    }
                    const eventCategory = notification.android_config.category
                    if (
                        eventCategory !== PushNotificationAction.Ding &&
                        eventCategory !== PushNotificationAction.Motion &&
                        eventCategory !== PushNotificationAction.IntercomDing
                    ) {
                        logDebug(
                            'Received v2 push notification with unknown category: ' +
                                eventCategory,
                        )
                        logDebug(JSON.stringify(notification))
                    }
                } else if (
                    'data' in notification &&
                    'gcmData' in notification.data &&
                    'alarm_meta' in notification.data.gcmData
                ) {
                    const deviceId =
                        notification.data.gcmData.alarm_meta.device_zid
                    if (deviceId) {
                        sendToDevice(deviceId, notification)
                    }
                } else {
                    // This is not a v1 or v2 style notification, so we can't process it
                    logDebug('Received push notification in unknown format')
                    logDebug(JSON.stringify(notification))
                    return
                }
            } catch (e) {
                logError(e)
            }
        })
        // If we already have credentials and they haven't been changed during registration, use them immediately
        if (
            credentials &&
            credentials?.fcm?.token ===
                this.restClient._internalOnly_pushNotificationCredentials?.fcm
                    ?.token
        ) {
            onPushNotificationToken.next(credentials.fcm.token)
        }
    }

    async fetchRawLocations() {
        const { user_locations: rawLocations } =
            await this.restClient.request({
                url: locationInfoApi('locations'),
            })
        if (!rawLocations) {
            throw new Error(
                'The Ring account which you used to generate a refresh token does not have any associated locations.  Please use an account that has access to at least one location.',
            )
        }
        return rawLocations
    }

    async fetchAndBuildLocations() {
        const rawLocations = await this.fetchRawLocations(),
            {
                authorizedDoorbots,
                chimes,
                doorbots,
                allCameras,
                baseStations,
                beamBridges,
                intercoms,
            } = await this.fetchRingDevices(),
            locationIdsWithHubs = [...baseStations, ...beamBridges].map(
                (x) => x.location_id,
            ),
            cameras = allCameras.map(
                (data) =>
                    new RingCamera(
                        data,
                        doorbots.includes(data) ||
                            authorizedDoorbots.includes(data) ||
                            data.kind.startsWith('doorbell'),
                        this.restClient,
                        this.options.avoidSnapshotBatteryDrain || false,
                    ),
            ),
            ringChimes = chimes.map(
                (data) => new RingChime(data, this.restClient),
            ),
            ringIntercoms = intercoms.map(
                (data) => new RingIntercom(data, this.restClient),
            ),
            locations = rawLocations
                .filter((location) => {
                    return (
                        !Array.isArray(this.options.locationIds) ||
                        this.options.locationIds.includes(
                            location.location_id,
                        )
                    )
                })
                .map(
                    (location) =>
                        new Location(
                            location,
                            cameras.filter(
                                (x) =>
                                    x.data.location_id === location.location_id,
                            ),
                            ringChimes.filter(
                                (x) =>
                                    x.data.location_id === location.location_id,
                            ),
                            ringIntercoms.filter(
                                (x) =>
                                    x.data.location_id === location.location_id,
                            ),
                            {
                                hasHubs: locationIdsWithHubs.includes(
                                    location.location_id,
                                ),
                                hasAlarmBaseStation: baseStations.some(
                                    (station) =>
                                        station.location_id ===
                                        location.location_id,
                                ),
                                locationModePollingSeconds:
                                    this.options.locationModePollingSeconds,
                            },
                            this.restClient,
                        ),
                )
        this.listenForDeviceUpdates(cameras, ringChimes, ringIntercoms)
        this.registerPushReceiver(cameras, ringIntercoms).catch((e) => {
            logError(e)
        })
        return locations
    }

    locationsPromise

    getLocations() {
        if (!this.locationsPromise) {
            this.locationsPromise = this.fetchAndBuildLocations()
        }
        return this.locationsPromise
    }

    async getCameras() {
        const locations = await this.getLocations()
        return locations.reduce(
            (cameras, location) => [...cameras, ...location.cameras],
            [],
        )
    }

    getProfile() {
        return this.restClient.request({
            url: clientApi('profile'),
        })
    }

    disconnect() {
        this.unsubscribe()
        if (!this.locationsPromise) {
            return
        }
        this.getLocations()
            .then((locations) =>
                locations.forEach((location) => location.disconnect()),
            )
            .catch((e) => {
                logError(e)
            })
        this.restClient.clearTimeouts()
        clearTimeouts()
    }
}

