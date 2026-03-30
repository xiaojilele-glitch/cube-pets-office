import { describe, expect, it, vi } from 'vitest';

import { DatabaseMissionSnapshotStore } from '../db/mission-storage.js';
import type { MissionRecord } from '../../shared/mission/contracts.js';

function createMission(id: string): MissionRecord {
  return {
    id,
    kind: 'chat',
    title: `Mission ${id}`,
    status: 'queued',
    progress: 0,
    stages: [{ key: 'receive', label: 'Receive task', status: 'pending' }],
    createdAt: 1,
    updatedAt: 1,
    events: [],
  };
}

describe('DatabaseMissionSnapshotStore', () => {
  it('reads persisted missions from database.json first', () => {
    const dbMission = createMission('mission_db');
    const database = {
      getMissions: vi.fn(() => [dbMission]),
      saveMissions: vi.fn(),
    };
    const legacyStore = {
      load: vi.fn(() => [createMission('mission_legacy')]),
      save: vi.fn(),
    };

    const store = new DatabaseMissionSnapshotStore(database, legacyStore);
    const loaded = store.load();

    expect(loaded).toEqual([dbMission]);
    expect(database.saveMissions).not.toHaveBeenCalled();
    expect(legacyStore.load).not.toHaveBeenCalled();
  });

  it('migrates legacy mission snapshots into database.json when db is empty', () => {
    const legacyMission = createMission('mission_legacy');
    const database = {
      getMissions: vi.fn(() => []),
      saveMissions: vi.fn(),
    };
    const legacyStore = {
      load: vi.fn(() => [legacyMission]),
      save: vi.fn(),
    };

    const store = new DatabaseMissionSnapshotStore(database, legacyStore);
    const loaded = store.load();

    expect(loaded).toEqual([legacyMission]);
    expect(database.saveMissions).toHaveBeenCalledWith([legacyMission]);
  });

  it('writes missions back into database.json', () => {
    const database = {
      getMissions: vi.fn(() => []),
      saveMissions: vi.fn(),
    };

    const store = new DatabaseMissionSnapshotStore(database);
    const missions = [createMission('mission_save')];
    store.save(missions);

    expect(database.saveMissions).toHaveBeenCalledWith(missions);
  });
});
