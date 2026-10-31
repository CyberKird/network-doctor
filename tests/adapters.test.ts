import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  boostScript,
  parseAdapters,
  planBoost,
  revertScript,
  toggleScript,
} from '../src/main/net/adapters'

describe('adapter list', () => {
  it('classifies kind and status, and survives a single-object result', () => {
    const rows = [
      { Name: 'Wi-Fi', InterfaceDescription: 'TP-Link Wireless MU-MIMO USB Adapter', Status: 'Disconnected', LinkSpeed: '0 bps', PhysicalMediaType: 'Native 802.11' },
      { Name: 'Ethernet', InterfaceDescription: 'Realtek PCIe GbE Family Controller', Status: 'Up', LinkSpeed: '1 Gbps', PhysicalMediaType: '802.3' },
      { Name: 'Ethernet 3', InterfaceDescription: 'ASIX AX88179', Status: 'Disabled', LinkSpeed: '0 bps', PhysicalMediaType: '802.3' },
    ]
    const [wifi, eth, off] = parseAdapters(JSON.stringify(rows))
    assert.deepEqual([wifi.kind, wifi.status, wifi.speed], ['wifi', 'disconnected', ''])
    assert.deepEqual([eth.kind, eth.status, eth.speed], ['ethernet', 'up', '1 Gbps'])
    assert.equal(off.status, 'disabled')

    assert.equal(parseAdapters(JSON.stringify(rows[1])).length, 1)
    assert.deepEqual(parseAdapters(''), [])
  })
})

describe('boost plan', () => {
  const props = [
    { DisplayName: 'Green Ethernet', DisplayValue: 'Enabled', ValidDisplayValues: ['Disabled', 'Enabled'] },
    { DisplayName: 'Energy-Efficient Ethernet', DisplayValue: 'Disabled', ValidDisplayValues: ['Disabled', 'Enabled'] },
    { DisplayName: 'Roaming Aggressiveness', DisplayValue: '3. Medium', ValidDisplayValues: ['1. Lowest', '2. Medium-Low', '3. Medium'] },
    { DisplayName: 'Receive Buffers', DisplayValue: '512', NumericParameterMaxValue: 2048 },
    { DisplayName: 'Transmit Buffers', DisplayValue: '128', NumericParameterMaxValue: 128 },
    { DisplayName: 'Speed & Duplex', DisplayValue: 'Auto Negotiation', ValidDisplayValues: ['Auto Negotiation'] },
    { DisplayName: null, DisplayValue: 'x' },
  ]

  it('changes only what exists and differs, and never touches unrelated settings', () => {
    assert.deepEqual(planBoost(props), [
      { setting: 'Green Ethernet', from: 'Enabled', to: 'Disabled' },
      { setting: 'Roaming Aggressiveness', from: '3. Medium', to: '1. Lowest' },
      { setting: 'Receive Buffers', from: '512', to: '2048' },
    ])
  })

  it('plans nothing for a driver that exposes none of the settings', () => {
    assert.deepEqual(planBoost([props[5]]), [])
  })

  it('restarts the adapter once and quotes hostile names', () => {
    const plan = planBoost(props)
    const script = boostScript("O'Net", plan)
    assert.ok(script.includes("-Name 'O''Net'"))
    assert.equal(script.split('Restart-NetAdapter').length - 1, 1)
    assert.ok(script.includes('-NoRestart'))
    // Typographic apostrophes are string delimiters to PowerShell as well.
    assert.ok(toggleScript('a’b', false).includes("'a’’b'"))
    assert.ok(revertScript('Ethernet', [['Green Ethernet', 'Enabled']]).includes('Enable-NetAdapterPowerManagement'))
  })
})
