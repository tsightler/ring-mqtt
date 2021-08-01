module.exports = [
  {
    key: 'batteryLevel',
    title: 'Battery-Level',
    topic: 'battery-level',
    component: 'sensor',
    properties: {
      unit_of_measurement: '%',
      state_class: 'measurement',
      device_class: 'battery'
    }
  },
  {
    key: 'tamperStatus',
    title: 'Tamper Status',
    topic: 'tamper-status',
    component: 'binary_sensor',
    properties: {
      value_template: '{% if value is equalto "tamper" %} ON {% else %} OFF {% endif %}'
    }
  }
]
