module.exports = [
  {
    shouldSend: (device) => device.data.hasOwnProperty('batteryLevel'),
    getValue: (device) => device.data.batteryLevel === 99 ? 100 : device.data.batteryLevel,
    id: 'battery-level',
    title: 'Battery-Level',
    component: 'sensor',
    properties: {
      unit_of_measurement: '%',
      state_class: 'measurement',
      device_class: 'battery'
    }
  },
  {
    shouldSend: (device) => device.data.hasOwnProperty('tamperStatus'),
    getValue: (device) => device.data.tamperStatus,
    id: 'tamper-status',
    title: 'Tamper Status',
    component: 'binary_sensor',
    properties: {
      value_template: '{% if value is equalto "tamper" %} ON {% else %} OFF {% endif %}'
    }
  }
]
