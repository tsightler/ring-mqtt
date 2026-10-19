import {
    DoorbellType,
    PushNotificationAction,
    RingCameraKind,
    RingCameraModel,
} from './ring-types.js'
import { clientApi, deviceApi, deviceInfoApi, evmApi } from './rest-client.js'
import { BehaviorSubject, ReplaySubject, Subject } from 'rxjs'
import {
    distinctUntilChanged,
    filter,
    map,
    share,
    startWith,
    throttleTime,
} from 'rxjs/operators'
import { buildSearchString, logDebug, logError } from './util.js'
import { Subscribed } from './subscribed.js'

function parseBatteryLife(batteryLife) {
    if (batteryLife === null || batteryLife === undefined) {
        return null
    }
    const batteryLevel =
        typeof batteryLife === 'number'
            ? batteryLife
            : Number.parseFloat(batteryLife)
    if (isNaN(batteryLevel)) {
        return null
    }
    return batteryLevel
}

export function getBatteryLevel(data) {
    const levels = [
            parseBatteryLife(data.battery_life),
            parseBatteryLife(data.battery_life_2),
        ].filter((level) => level !== null),
        { health } = data
    if (
        !levels.length ||
        (health &&
            !health.battery_percentage &&
            !health.battery_present &&
            !health.second_battery_percentage)
    ) {
        return null
    }
    return Math.min(...levels)
}

// Matches the timestamp format used by the legacy health endpoints
// (ex. 2026-08-25T23:01:14+00:00)
function formatHealthUpdatedAt(lastUpdateTime) {
    const updatedAt = lastUpdateTime
        ? new Date(lastUpdateTime * 1000)
        : new Date()
    return updatedAt.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

// The legacy clients_api health endpoint only works for devices owned by the
// authenticated account, returning a 404 for shared devices, so health is
// instead derived from the health data included with the device data
export function mapCameraHealth(id, health) {
    if (!health || !Object.keys(health).length) {
        // Some device types (chimes, for example) have no health data in the
        // device_info api and must continue to use the legacy health endpoint
        return undefined
    }
    const { rssi, rssi_category: rssiCategory, ...rest } = health
    return {
        id,
        wifi_name: rest.wifi_name,
        battery_percentage: rest.battery_percentage,
        battery_percentage_category:
            rest.battery_percentage_category ?? 'unknown',
        battery_voltage: rest.battery_voltage ?? null,
        battery_voltage_category: rest.battery_voltage_category ?? null,
        latest_signal_strength: rssi ?? null,
        latest_signal_category: rssiCategory ?? 'NA',
        average_signal_strength: rssi ?? null,
        average_signal_category: rssiCategory ?? 'NA',
        firmware: rest.firmware_version_status ?? rest.firmware_version ?? '',
        updated_at: formatHealthUpdatedAt(rest.last_update_time),
        wifi_is_ring_network: rest.wifi_is_ring_network,
        packet_loss_category: rest.packet_loss_category ?? 'NA',
        packet_loss_strength: rest.packet_loss ?? null,
        network_connection: rest.network_connection_value,
        transformer_voltage: rest.transformer_voltage,
        transformer_voltage_category: rest.transformer_voltage_category,
        ext_power_state: rest.ext_power_state,
    }
}

// The evm history api replaces the legacy clients_api events endpoints, which
// return a 404 for devices that are shared with, but not owned by, this account
export function getEventHistory(restClient, sourceIds, options = {}) {
    const { limit, kind, state, favorites, olderThanId, pagination_key } =
            options,
        queryString = Object.entries({
            source_ids: sourceIds.join(','),
            limit,
            event_types: kind,
            state,
            favorites,
            pagination_key: pagination_key ?? olderThanId,
        })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
            .join('&')
    return restClient
        .request({
            url: evmApi(`history/devices?${queryString}`),
        })
        .then(({ events, pagination_key: paginationKey }) => ({
            events: (events ?? []).map((event) => ({
                ...event,
                created_at: event.start_time,
                cv_properties: event.cv,
                ding_id: Number(event.event_id),
                ding_id_str: event.event_id,
                doorbot_id: Number(event.source_id),
                favorite: event.is_favorite,
                kind: event.event_type,
                recorded: event.recording_status === 'ready',
            })),
            meta: { pagination_key: paginationKey },
            pagination_key: paginationKey,
        }))
}

export function getSearchQueryString(options) {
    const queryString = Object.entries(options)
        .map(([key, value]) => {
            if (value === undefined) {
                return ''
            }
            if (key === 'olderThanId') {
                key = 'pagination_key'
            }
            return `${key}=${value}`
        })
        .filter((x) => x)
        .join('&')
    return queryString.length ? `?${queryString}` : ''
}

// Motion notifications arrive without data.event.ding.id, so fall back to
// identifiers which are still unique per event.  Without this every motion
// notification for a camera resolves to the same undefined id, which lets one
// notification expire another that is still active.
function getNotificationId(notification) {
    const { ding, riid } = notification.data.event
    return ding.id ?? notification.analytics?.server_correlation_id ?? riid
}

export function cleanSnapshotUuid(uuid) {
    if (!uuid) {
        return uuid
    }
    return uuid.replace(/:.*$/, '')
}

const wiredModelsWithNoSnapshotDuringRecording = new Set([
        RingCameraKind.doorbell_graham_cracker,
    ]),
    enabledDoorbellTypes = new Set([
        DoorbellType.Mechanical,
        DoorbellType.Digital,
    ])

export class RingCamera extends Subscribed {
    id
    deviceType
    model
    onData
    hasLight
    hasSiren
    onRequestUpdate = new Subject()
    onNewNotification = new Subject()
    onActiveNotifications = new BehaviorSubject([])
    onDoorbellPressed = this.onNewNotification.pipe(
        filter(
            (notification) =>
                notification.android_config.category ===
                PushNotificationAction.Ding,
        ),
        share(),
    )
    onMotionDetected = this.onActiveNotifications.pipe(
        map((notifications) =>
            notifications.some(
                (notification) =>
                    notification.android_config.category ===
                    PushNotificationAction.Motion,
            ),
        ),
        distinctUntilChanged(),
        share({
            connector: () => new ReplaySubject(1),
            resetOnError: false,
            resetOnComplete: false,
            resetOnRefCountZero: false,
        }),
    )
    onMotionStarted = this.onMotionDetected.pipe(
        filter((currentlyDetected) => currentlyDetected),
        map(() => null), // no value needed, event is what matters
        share(),
    )
    onBatteryLevel
    onInHomeDoorbellStatus
    initialData
    isDoorbot
    restClient
    avoidSnapshotBatteryDrain

    constructor(
        initialData,
        isDoorbot,
        restClient,
        avoidSnapshotBatteryDrain,
    ) {
        super()
        this.initialData = initialData
        this.isDoorbot = isDoorbot
        this.restClient = restClient
        this.avoidSnapshotBatteryDrain = avoidSnapshotBatteryDrain
        this.id = this.initialData.id
        this.deviceType = this.initialData.kind
        this.model =
            RingCameraModel[this.initialData.kind] || 'Unknown Model'
        this.onData = new BehaviorSubject(this.initialData)
        this.hasLight = this.initialData.led_status !== undefined
        this.hasSiren = this.initialData.siren_status !== undefined
        this.onBatteryLevel = this.onData.pipe(
            map((data) => {
                if (!('battery_life' in data)) {
                    return null
                }
                return getBatteryLevel(data)
            }),
            distinctUntilChanged(),
        )
        this.onInHomeDoorbellStatus = this.onData.pipe(
            map(({ settings: { chime_settings } }) => {
                return Boolean(chime_settings?.enable)
            }),
            distinctUntilChanged(),
        )
        this.addSubscriptions(
            this.restClient.onSession
                .pipe(startWith(undefined), throttleTime(1000)) // Force this to run immediately, but don't double run if a session is created due to these api calls
                .subscribe(() => {
                    if (!this.canSubscribeToNotifications) {
                        logDebug(
                            initialData.description +
                                ' is shared with this account without the device_alerts_manage operation, so it cannot be subscribed to ding/motion notifications',
                        )
                        return
                    }
                    this.subscribeToDingEvents().catch((e) => {
                        logError(
                            'Failed to subscribe ' +
                                initialData.description +
                                ' to ding events',
                        )
                        logError(e)
                    })
                    this.subscribeToMotionEvents().catch((e) => {
                        logError(
                            'Failed to subscribe ' +
                                initialData.description +
                                ' to motion events',
                        )
                        logError(e)
                    })
                }),
        )
    }

    updateData(update) {
        this.onData.next(update)
    }

    requestUpdate() {
        this.onRequestUpdate.next(null)
    }

    get data() {
        return this.onData.getValue()
    }

    get name() {
        return this.data.description
    }

    get activeNotifications() {
        return this.onActiveNotifications.getValue()
    }

    get latestNotification() {
        const notifications = this.activeNotifications
        return notifications[notifications.length - 1]
    }

    get latestNotificationSnapshotUuid() {
        const notification = this.latestNotification
        return notification?.img?.snapshot_uuid
    }

    get batteryLevel() {
        if (!('battery_life' in this.data)) {
            return null
        }
        return getBatteryLevel(this.data)
    }

    get hasBattery() {
        return this.batteryLevel !== null
    }

    get hasLowBattery() {
        return this.data.alerts.battery === 'low'
    }

    get isCharging() {
        if (!('external_connection' in this.data)) {
            return false
        }
        return this.data.external_connection
    }

    get operatingOnBattery() {
        return this.hasBattery && this.data.settings.power_mode !== 'wired'
    }

    get canTakeSnapshotWhileRecording() {
        return (
            !this.operatingOnBattery &&
            !wiredModelsWithNoSnapshotDuringRecording.has(this.data.kind)
        )
    }

    get isOffline() {
        return this.data.alerts.connection === 'offline'
    }

    // Operations this account is allowed to perform on the device.  Devices
    // shared by another account may allow only a subset, and the api answers
    // with a 404 for anything outside of it.  Undefined when the api did not
    // report an operation set, in which case no operation should be assumed
    // unavailable.
    canPerformOperation(operation) {
        const { operations } = this.data
        return operations ? operations.includes(operation) : undefined
    }

    // device_alerts_manage is required to subscribe to ding/motion notifications
    get canSubscribeToNotifications() {
        return this.canPerformOperation('device_alerts_manage') !== false
    }

    get isRingEdgeEnabled() {
        return this.data.settings.sheila_settings.local_storage_enabled === true
    }

    get hasInHomeDoorbell() {
        const { chime_settings } = this.data.settings
        return (
            this.isDoorbot &&
            Boolean(
                chime_settings &&
                    enabledDoorbellTypes.has(chime_settings.type),
            )
        )
    }

    doorbotUrl(path = '') {
        return clientApi(`doorbots/${this.id}/${path}`)
    }

    deviceUrl(path = '') {
        return deviceApi(`devices/${this.id}/${path}`)
    }

    async setLight(on) {
        if (!this.hasLight) {
            return false
        }
        const state = on ? 'on' : 'off'
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl('floodlight_light_' + state),
        })
        this.updateData({ ...this.data, led_status: state })
        return true
    }

    async setSiren(on) {
        if (!this.hasSiren) {
            return false
        }
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl('siren_' + (on ? 'on' : 'off')),
        })
        const seconds = on ? 1 : 0
        this.updateData({
            ...this.data,
            siren_status: { seconds_remaining: seconds },
        })
        return true
    }

    async setSettings(settings) {
        await this.restClient.request({
            method: 'PUT',
            url: this.doorbotUrl(),
            json: { doorbot: { settings } },
        })
        this.requestUpdate()
    }

    async setDeviceSettings(settings) {
        const response = await this.restClient.request({
            method: 'PATCH',
            url: this.deviceUrl('settings'),
            json: settings,
        })
        this.requestUpdate()
        return response
    }

    getDeviceSettings() {
        return this.restClient.request({
            method: 'GET',
            url: this.deviceUrl('settings'),
        })
    }

    // Enable or disable the in-home doorbell (if digital or mechanical)
    async setInHomeDoorbell(enable) {
        if (!this.hasInHomeDoorbell) {
            return false
        }
        await this.setSettings({ chime_settings: { enable } })
        return true
    }

    async getHealth() {
        const { device } = await this.restClient.request({
            url: deviceInfoApi(`devices/${this.id}`),
        })
        return mapCameraHealth(this.id, device.health)
    }

    removeDingById(idToRemove) {
        const allActiveDings = this.activeNotifications,
            otherDings = allActiveDings.filter(
                (notification) =>
                    getNotificationId(notification) !== idToRemove,
            )
        this.onActiveNotifications.next(otherDings)
    }

    processPushNotification(notification) {
        if (
            !('android_config' in notification) ||
            !('event' in notification.data) ||
            !('ding' in (notification.data?.event ?? {}))
        ) {
            // only process ding/motion notifications
            return
        }
        const activeDings = this.activeNotifications,
            dingId = getNotificationId(notification)
        this.onActiveNotifications.next(
            activeDings
                .filter((d) => getNotificationId(d) !== dingId)
                .concat([notification]),
        )
        this.onNewNotification.next(notification)
        setTimeout(() => {
            this.removeDingById(dingId)
        }, 65 * 1000) // dings last ~1 minute
    }

    getEvents(options = {}) {
        return getEventHistory(this.restClient, [this.id], options)
    }

    get snapshotsAreBlocked() {
        return this.data.settings.motion_detection_enabled === false
    }

    lastSnapshotTimestamp = 0
    lastSnapshotTimestampLocal = 0

    async getNextSnapshot({ afterMs, maxWaitMs, force, uuid }) {
        const response = await this.restClient.request({
                url: `https://app-snaps.ring.com/snapshots/next/${
                    this.id
                }${buildSearchString({
                    'after-ms': afterMs,
                    'max-wait-ms': maxWaitMs,
                    extras: force ? 'force' : undefined,
                    uuid: cleanSnapshotUuid(uuid),
                })}`,
                responseType: 'buffer',
                headers: {
                    accept: 'image/jpeg',
                },
                allowNoResponse: true,
            }),
            { responseTimestamp, timeMillis } = response,
            timestampAge = Math.abs(responseTimestamp - timeMillis)
        this.lastSnapshotTimestamp = timeMillis
        this.lastSnapshotTimestampLocal = Date.now() - timestampAge
        return response
    }

    getSnapshotByUuid(uuid) {
        return this.restClient.request({
            url: clientApi('snapshots/uuid?uuid=' + cleanSnapshotUuid(uuid)),
            responseType: 'buffer',
            headers: {
                accept: 'image/jpeg',
            },
        })
    }

    subscribeToDingEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('subscribe'),
        })
    }

    unsubscribeFromDingEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('unsubscribe'),
        })
    }

    subscribeToMotionEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('motions_subscribe'),
        })
    }

    unsubscribeFromMotionEvents() {
        return this.restClient.request({
            method: 'POST',
            url: this.doorbotUrl('motions_unsubscribe'),
        })
    }

    disconnect() {
        this.unsubscribe()
    }
}

