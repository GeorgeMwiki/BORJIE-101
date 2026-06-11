/**
 * Employee-home wire-contract tests — pins the api-gateway envelope shape.
 *
 * REGRESSION GUARD: GET /tasks (and every mining list route) answers the
 * canonical `{ success, data: rows }` envelope. The employee hooks used to
 * unwrap invented keys (`data.tasks` / `data.talk` / `data.incidents`) that
 * the gateway never sends, so React Query resolved `undefined`, rejected,
 * and the worker inbox showed an eternal loading line. These tests exercise
 * the injectable fetchers the hooks delegate to, asserting:
 *   1. the exact path + query params sent,
 *   2. the `{ success, data }` unwrap,
 *   3. that the OLD wrong shapes yield empty results (documented breakage),
 *   4. wire-row → render-contract adaptation.
 */

import { describe, expect, it } from 'vitest'
import {
  adaptIncidentAlert,
  adaptToolboxTalk,
  adaptWorkerTask,
  fetchActiveAlerts,
  fetchTodayTasks,
  fetchToolboxTalk,
  type ListEnvelope,
  type MiningGetApi
} from '../queries.adapters'

interface RecordedCall {
  readonly path: string
  readonly query: Readonly<Record<string, string | number | boolean | undefined>>
}

function fakeApi(response: unknown): {
  readonly api: MiningGetApi
  readonly calls: ReadonlyArray<RecordedCall>
} {
  const calls: RecordedCall[] = []
  const api: MiningGetApi = {
    get: async <T,>(
      path: string,
      options?: {
        readonly query?: Readonly<
          Record<string, string | number | boolean | undefined>
        >
      }
    ): Promise<T> => {
      calls.push({ path, query: options?.query ?? {} })
      return response as T
    }
  }
  return { api, calls }
}

const WIRE_TASK_ROW = {
  id: 'task-1',
  tenantId: 'tnt-1',
  assignedToUserId: 'worker-1',
  titleSw: 'Toa sample kutoka shimo 3',
  titleEn: 'Take sample from pit 3',
  priority: 'high',
  status: 'pending',
  dueAt: '2026-06-11T09:00:00.000Z',
  createdAt: '2026-06-10T07:00:00.000Z'
} as const

describe('fetchTodayTasks — GET /tasks contract', () => {
  it('sends assignedTo + status=open and unwraps { success, data }', async () => {
    const envelope: ListEnvelope = { success: true, data: [WIRE_TASK_ROW] }
    const { api, calls } = fakeApi(envelope)

    const tasks = await fetchTodayTasks(api, 'worker-1')

    expect(calls).toEqual([
      { path: '/tasks', query: { assignedTo: 'worker-1', status: 'open' } }
    ])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe('task-1')
    expect(tasks[0]?.titleSw).toBe('Toa sample kutoka shimo 3')
  })

  it('returns [] for the OLD wrong { tasks } shape instead of undefined', async () => {
    // The pre-fix unwrap read `data.tasks` — a key the gateway never sends.
    const { api } = fakeApi({ tasks: [WIRE_TASK_ROW] })
    const tasks = await fetchTodayTasks(api, 'worker-1')
    expect(tasks).toEqual([])
  })

  it('returns [] when data is missing entirely', async () => {
    const { api } = fakeApi({ success: true })
    await expect(fetchTodayTasks(api, 'worker-1')).resolves.toEqual([])
  })
})

describe('adaptWorkerTask — wire row → render contract', () => {
  it('maps priority high→due, urgent→urgent, normal→flex', () => {
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, priority: 'high' }, 0).priority).toBe('due')
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, priority: 'urgent' }, 0).priority).toBe('urgent')
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, priority: 'normal' }, 0).priority).toBe('flex')
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, priority: 'low' }, 0).priority).toBe('flex')
  })

  it('maps status pending→open and passes through the live states', () => {
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, status: 'pending' }, 0).status).toBe('open')
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, status: 'in_progress' }, 0).status).toBe('in_progress')
    expect(adaptWorkerTask({ ...WIRE_TASK_ROW, status: 'blocked' }, 0).status).toBe('blocked')
  })

  it('falls back titleEn → titleSw and derives positional sequence', () => {
    const adapted = adaptWorkerTask({ ...WIRE_TASK_ROW, titleEn: null }, 2)
    expect(adapted.titleEn).toBe(WIRE_TASK_ROW.titleSw)
    expect(adapted.sequence).toBe(3)
    expect(adapted.dueAtIso).toBe('2026-06-11T09:00:00.000Z')
  })
})

describe('fetchToolboxTalk — GET /toolbox-talks contract', () => {
  it('unwraps { success, data } and adapts the first topic row', async () => {
    const envelope: ListEnvelope = {
      success: true,
      data: [
        {
          id: 'talk-1',
          topicSw: 'Usalama wa kuteremka shimoni',
          topicEn: 'Pit descent safety',
          scheduledFor: '2026-06-11'
        }
      ]
    }
    const { api, calls } = fakeApi(envelope)

    const talk = await fetchToolboxTalk(api)

    expect(calls).toEqual([
      { path: '/toolbox-talks', query: { date: 'today' } }
    ])
    expect(talk).toEqual({
      id: 'talk-1',
      titleSw: 'Usalama wa kuteremka shimoni',
      titleEn: 'Pit descent safety',
      required: true,
      acknowledgedAtIso: null
    })
  })

  it('returns null for an empty list and for the OLD { talk } shape', async () => {
    const empty = fakeApi({ success: true, data: [] })
    await expect(fetchToolboxTalk(empty.api)).resolves.toBeNull()

    const legacy = fakeApi({ talk: { id: 'talk-1' } })
    await expect(fetchToolboxTalk(legacy.api)).resolves.toBeNull()
  })
})

describe('fetchActiveAlerts — GET /incidents contract', () => {
  it('sends status=open and unwraps { success, data }', async () => {
    const envelope: ListEnvelope = {
      success: true,
      data: [
        {
          id: 'inc-1',
          kind: 'safety',
          severity: 'critical',
          description: 'Rockfall near adit 2',
          occurredAt: '2026-06-11T05:30:00.000Z',
          status: 'open'
        }
      ]
    }
    const { api, calls } = fakeApi(envelope)

    const alerts = await fetchActiveAlerts(api)

    expect(calls).toEqual([{ path: '/incidents', query: { status: 'open' } }])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.severity).toBe('high')
    expect(alerts[0]?.raisedAtIso).toBe('2026-06-11T05:30:00.000Z')
  })

  it('returns [] for the OLD wrong { incidents } shape', async () => {
    const { api } = fakeApi({ incidents: [{ id: 'inc-1' }] })
    await expect(fetchActiveAlerts(api)).resolves.toEqual([])
  })
})

describe('adaptIncidentAlert / adaptToolboxTalk — severity + fallbacks', () => {
  it('folds critical into high and defaults unknown severity to low', () => {
    expect(adaptIncidentAlert({ id: 'i', severity: 'critical' }).severity).toBe('high')
    expect(adaptIncidentAlert({ id: 'i', severity: 'medium' }).severity).toBe('medium')
    expect(adaptIncidentAlert({ id: 'i', severity: 'weird' }).severity).toBe('low')
  })

  it('falls back the alert title to kind when description is empty', () => {
    const alert = adaptIncidentAlert({ id: 'i', kind: 'near_miss', description: null })
    expect(alert.titleSw).toBe('near_miss')
    expect(alert.titleEn).toBe('near_miss')
  })

  it('toolbox talk falls back topicEn → topicSw', () => {
    const talk = adaptToolboxTalk([{ id: 't', topicSw: 'Vifaa vya kujikinga' }])
    expect(talk?.titleEn).toBe('Vifaa vya kujikinga')
  })
})
