import path from "node:path";

import type { MissionRecord } from "../../shared/mission/contracts.js";
import { MissionFileSnapshotStore } from "../tasks/mission-store.file.js";
import type { MissionSnapshotStore } from "../tasks/mission-store.js";
import db from "./index.js";

export const DEFAULT_MISSION_SNAPSHOT_FILENAME = "mission-snapshots.json";

export interface MissionDatabaseStore {
  getMissions(): MissionRecord[];
  saveMissions(missions: MissionRecord[]): void;
}

export function getMissionDataDir(): string {
  return path.resolve(process.cwd(), "data", "missions");
}

export function getMissionSnapshotFilePath(
  filename = DEFAULT_MISSION_SNAPSHOT_FILENAME
): string {
  return path.join(getMissionDataDir(), filename);
}

export class DatabaseMissionSnapshotStore implements MissionSnapshotStore {
  constructor(
    private readonly database: MissionDatabaseStore = db,
    private readonly legacyStore: MissionSnapshotStore = new MissionFileSnapshotStore(
      getMissionSnapshotFilePath()
    )
  ) {}

  load(): MissionRecord[] {
    const persisted = this.database.getMissions();
    if (persisted.length > 0) {
      return persisted;
    }

    const legacy = this.legacyStore.load();
    if (legacy.length > 0) {
      this.database.saveMissions(legacy);
    }
    return legacy;
  }

  save(tasks: MissionRecord[]): void {
    this.database.saveMissions(tasks);
  }
}
