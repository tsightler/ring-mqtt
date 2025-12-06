// Centralize environment variable defaults in one place.
// This improves maintainability by avoiding repeated access patterns
export const {
    RINGMQTT_CONFIG = '/data/config.json',
    RUNMODE = "standard",
    HAMQTTHOST,
    HAHOSTNAME,
    HAMQTTUSER,
    HAMQTTPASS
} = process.env;