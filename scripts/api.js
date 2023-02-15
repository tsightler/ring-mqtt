"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingApi = void 0;
const rest_client_1 = require("./rest-client");
const location_1 = require("./location");
const ring_types_1 = require("./ring-types");
const ring_camera_1 = require("./ring-camera");
const ring_chime_1 = require("./ring-chime");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const util_1 = require("./util");
const ffmpeg_1 = require("./ffmpeg");
const subscribed_1 = require("./subscribed");
const push_receiver_1 = __importDefault(require("@eneris/push-receiver"));
const ring_intercom_1 = require("./ring-intercom");
class RingApi extends subscribed_1.Subscribed {
    constructor(options) {
        super();
        this.options = options;
        this.restClient = new rest_client_1.RingRestClient(this.options);
        this.onRefreshTokenUpdated =
            this.restClient.onRefreshTokenUpdated.asObservable();
        if (options.debug) {
            (0, util_1.enableDebug)();
        }
        const { locationIds, ffmpegPath } = options;
        if (locationIds && !locationIds.length) {
            (0, util_1.logError)('Your Ring config has `"locationIds": []`, which means no locations will be used and no devices will be found.');
        }
        if (ffmpegPath) {
            (0, ffmpeg_1.setFfmpegPath)(ffmpegPath);
        }
    }
    async fetchRingDevices() {
        console.log('fetchRingDevices called')
        const { doorbots, chimes, authorized_doorbots: authorizedDoorbots, stickup_cams: stickupCams, base_stations: baseStations, beams_bridges: beamBridges, other: otherDevices, } = await this.restClient.request({ url: (0, rest_client_1.clientApi)('ring_devices') }), onvifCameras = [], intercoms = [], thirdPartyGarageDoorOpeners = [], unknownDevices = [];
        otherDevices.forEach((device) => {
            switch (device.kind) {
                case ring_types_1.RingDeviceType.OnvifCamera:
                    onvifCameras.push(device);
                    break;
                case ring_types_1.RingDeviceType.IntercomHandsetAudio:
                    intercoms.push(device);
                    break;
                case ring_types_1.RingDeviceType.ThirdPartyGarageDoorOpener:
                    thirdPartyGarageDoorOpeners.push(device);
                    break;
                default:
                    unknownDevices.push(device);
                    break;
            }
        });
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
        };
    }
    listenForDeviceUpdates(cameras, chimes, intercoms) {
        const { cameraStatusPollingSeconds } = this.options;
        if (!cameraStatusPollingSeconds) {
            return;
        }
        const devices = [...cameras, ...chimes, ...intercoms], onDeviceRequestUpdate = (0, rxjs_1.merge)(...devices.map((device) => device.onRequestUpdate)), onUpdateReceived = new rxjs_1.Subject(), onPollForStatusUpdate = cameraStatusPollingSeconds
            ? onUpdateReceived.pipe((0, operators_1.debounceTime)(cameraStatusPollingSeconds * 1000))
            : rxjs_1.EMPTY, camerasById = cameras.reduce((byId, camera) => {
            byId[camera.id] = camera;
            return byId;
        }, {}), chimesById = chimes.reduce((byId, chime) => {
            byId[chime.id] = chime;
            return byId;
        }, {}), intercomsById = intercoms.reduce((byId, intercom) => {
            byId[intercom.id] = intercom;
            return byId;
        }, {});
        if (!cameras.length && !chimes.length) {
            return;
        }
        this.addSubscriptions((0, rxjs_1.merge)(onDeviceRequestUpdate, onPollForStatusUpdate)
            .pipe((0, operators_1.throttleTime)(500), (0, operators_1.switchMap)(() => this.fetchRingDevices().catch(() => null)))
            .subscribe((response) => {
            console.log(response)
            onUpdateReceived.next(null);
            if (!response) {
                return;
            }
            response.allCameras.forEach((data) => {
                const camera = camerasById[data.id];
                if (camera) {
                    camera.updateData(data);
                }
            });
            response.chimes.forEach((data) => {
                const chime = chimesById[data.id];
                if (chime) {
                    chime.updateData(data);
                }
            });
            response.intercoms.forEach((data) => {
                const intercom = intercomsById[data.id];
                if (intercom) {
                    intercom.updateData(data);
                }
            });
        }));
        if (cameraStatusPollingSeconds) {
            onUpdateReceived.next(null); // kick off polling
        }
    }
    async registerPushReceiver(cameras, intercoms) {
        const pushReceiver = new push_receiver_1.default({
            logLevel: 'NONE',
            senderId: '876313859327', // for Ring android app.  703521446232 for ring-site
        }), devicesById = {}, sendToDevice = (id, notification) => {
            devicesById[id]?.processPushNotification(notification);
        };
        for (const camera of cameras) {
            devicesById[camera.id] = camera;
        }
        for (const intercom of intercoms) {
            devicesById[intercom.id] = intercom;
        }
        pushReceiver.onCredentialsChanged(async ({ newCredentials: { fcm: { token }, }, }) => {
            try {
                await this.restClient.request({
                    url: (0, rest_client_1.clientApi)('device'),
                    method: 'PATCH',
                    json: {
                        device: {
                            metadata: {
                                ...this.restClient.baseSessionMetadata,
                                pn_service: 'fcm',
                            },
                            os: 'android',
                            push_notification_token: token,
                        },
                    },
                });
            }
            catch (e) {
                (0, util_1.logError)(e);
            }
        });
        pushReceiver.onNotification(({ message }) => {
            const dataJson = message.data?.gcmData;
            try {
                const notification = JSON.parse(dataJson);
                if ('ding' in notification) {
                    sendToDevice(notification.ding.doorbot_id, notification);
                }
                else if ('alarm_meta' in notification) {
                    // Alarm notification, such as intercom unlocked
                    sendToDevice(notification.alarm_meta.device_zid, notification);
                }
            }
            catch (e) {
                (0, util_1.logError)(e);
            }
        });
        try {
            await pushReceiver.connect();
        }
        catch (e) {
            (0, util_1.logError)('Failed to connect push notification receiver');
            (0, util_1.logError)(e);
        }
    }
    async fetchRawLocations() {
        const { user_locations: rawLocations } = await this.restClient.request({ url: (0, rest_client_1.deviceApi)('locations') });
        if (!rawLocations) {
            throw new Error('The Ring account which you used to generate a refresh token does not have any associated locations.  Please use an account that has access to at least one location.');
        }
        return rawLocations;
    }
    fetchAmazonKeyLocks() {
        return this.restClient.request({
            url: 'https://api.ring.com/integrations/amazonkey/v2/devices/lock_associations',
        });
    }
    async fetchAndBuildLocations() {
        const rawLocations = await this.fetchRawLocations(), { authorizedDoorbots, chimes, doorbots, allCameras, baseStations, beamBridges, intercoms, } = await this.fetchRingDevices(), locationIdsWithHubs = [...baseStations, ...beamBridges].map((x) => x.location_id), cameras = allCameras.map((data) => new ring_camera_1.RingCamera(data, doorbots.includes(data) ||
            authorizedDoorbots.includes(data) ||
            data.kind.startsWith('doorbell'), this.restClient, this.options.avoidSnapshotBatteryDrain || false)), ringChimes = chimes.map((data) => new ring_chime_1.RingChime(data, this.restClient)), ringIntercoms = intercoms.map((data) => new ring_intercom_1.RingIntercom(data, this.restClient)), locations = rawLocations
            .filter((location) => {
            return (!Array.isArray(this.options.locationIds) ||
                this.options.locationIds.includes(location.location_id));
        })
            .map((location) => new location_1.Location(location, cameras.filter((x) => x.data.location_id === location.location_id), ringChimes.filter((x) => x.data.location_id === location.location_id), ringIntercoms.filter((x) => x.data.location_id === location.location_id), {
            hasHubs: locationIdsWithHubs.includes(location.location_id),
            hasAlarmBaseStation: baseStations.some((station) => station.location_id === location.location_id),
            locationModePollingSeconds: this.options.locationModePollingSeconds,
        }, this.restClient));
        this.listenForDeviceUpdates(cameras, ringChimes, ringIntercoms);
        this.registerPushReceiver(cameras, ringIntercoms).catch((e) => {
            (0, util_1.logError)(e);
        });
        return locations;
    }
    getLocations() {
        if (!this.locationsPromise) {
            this.locationsPromise = this.fetchAndBuildLocations();
        }
        return this.locationsPromise;
    }
    async getCameras() {
        const locations = await this.getLocations();
        return locations.reduce((cameras, location) => [...cameras, ...location.cameras], []);
    }
    getProfile() {
        return this.restClient.request({
            url: (0, rest_client_1.clientApi)('profile'),
        });
    }
    disconnect() {
        this.unsubscribe();
        if (!this.locationsPromise) {
            return;
        }
        this.getLocations()
            .then((locations) => locations.forEach((location) => location.disconnect()))
            .catch((e) => {
            (0, util_1.logError)(e);
        });
        this.restClient.clearTimeouts();
    }
}
exports.RingApi = RingApi;
