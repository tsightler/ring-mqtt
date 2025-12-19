/**
 * Global constants for ring-mqtt
 *
 * This file contains constants for:
 * - Port numbers that users might need to configure
 * - Values used in multiple locations
 * - Configuration defaults
 * - Non-obvious timing values with specific requirements
 *
 * Simple delays (sleep(2), sleep(10), etc.) are kept inline in the code
 * where they're self-explanatory and only used once.
 */

// ============================================================================
// Network Ports
// ============================================================================

/**
 * Port for the web UI server used for token generation
 */
export const WEB_UI_PORT = 55123

/**
 * Port for internal IPC MQTT broker (localhost only)
 */
export const IPC_MQTT_PORT = 51883

/**
 * IP address for IPC MQTT broker (localhost)
 */
export const IPC_MQTT_HOST = '127.0.0.1'

/**
 * Default MQTT broker port (unencrypted)
 */
export const MQTT_DEFAULT_PORT = '1883'

/**
 * Default MQTT broker port (encrypted with TLS/SSL)
 */
export const MQTTS_DEFAULT_PORT = '8883'

// ============================================================================
// Device Configuration
// ============================================================================

/**
 * Number of times to republish device config/state after startup or HA restart
 * Ensures Home Assistant has successfully received all device configurations
 */
export const DEVICE_REPUBLISH_COUNT = 6

/**
 * Initial heartbeat value for polled devices (cameras, chimes)
 * Decrements every 20 seconds until reset by data poll
 */
export const INITIAL_HEARTBEAT_VALUE = 3

/**
 * Interval (in seconds) for checking device heartbeat status
 * Documented in code as polling every 20 seconds
 */
export const HEARTBEAT_CHECK_INTERVAL_SEC = 20

/**
 * Polling interval (in seconds) for camera status updates
 * Value passed to Ring API
 */
export const CAMERA_STATUS_POLLING_SEC = 20

/**
 * Polling interval (in seconds) for location mode updates
 * Value passed to Ring API
 */
export const LOCATION_MODE_POLLING_SEC = 20

/**
 * Time to wait (in seconds) before setting devices offline when websocket disconnects
 * Prevents "unknown" state for transient connection issues
 */
export const WEBSOCKET_OFFLINE_DELAY_SEC = 30

/**
 * Time to wait (in seconds) between device republish cycles
 */
export const DEVICE_REPUBLISH_DELAY_SEC = 30

/**
 * Time to wait (in seconds) after Home Assistant restart before republishing devices
 */
export const HA_RESTART_REPUBLISH_DELAY_SEC = 15

// ============================================================================
// Device Discovery Configuration
// ============================================================================

/**
 * Interval (in milliseconds) for logging status during device discovery
 */
export const DEVICE_DISCOVERY_LOG_INTERVAL_MS = 10000

/**
 * Frequency of status logging during device discovery (every N intervals)
 * suppressInterval % 30 === 0 means log every 300 seconds (30 * 10 second intervals)
 */
export const DEVICE_DISCOVERY_LOG_FREQUENCY = 30

/**
 * Maximum number of camera events to retrieve from Ring API
 */
export const CAMERA_EVENT_HISTORY_LIMIT = 100

// ============================================================================
// Default Configuration Values
// ============================================================================

/**
 * Default MQTT topic prefix for Ring devices
 */
export const DEFAULT_RING_TOPIC = 'ring'

/**
 * Default Home Assistant status topic
 */
export const DEFAULT_HASS_TOPIC = 'homeassistant/status'

/**
 * Default value for enabling camera support
 */
export const DEFAULT_ENABLE_CAMERAS = true

/**
 * Default value for enabling modes support
 */
export const DEFAULT_ENABLE_MODES = false

/**
 * Default value for enabling panic button
 */
export const DEFAULT_ENABLE_PANIC = false

/**
 * Default disarm code (empty string means none required)
 */
export const DEFAULT_DISARM_CODE = ''
