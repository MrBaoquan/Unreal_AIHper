import { releaseManualReleaseDelegate, toManualReleaseDelegate } from 'puerts';
import * as UE from 'ue';

export type SaveGamePayload = Record<string, unknown>;

export interface SaveGameSlotOptions {
    userIndex?: number;
}

export interface SaveJsonOptions extends SaveGameSlotOptions {
    schemaVersion?: number;
}

export interface LoadJsonOptions extends SaveGameSlotOptions {
    expectedSchemaVersion?: number;
    migrate?: SaveGameMigration;
}

export interface SaveGameMigrationContext {
    slotName: string;
    userIndex: number;
    fromSchemaVersion: number;
    toSchemaVersion: number;
}

export type SaveGameMigration<TInput extends SaveGamePayload = SaveGamePayload, TOutput extends SaveGamePayload = SaveGamePayload> = (
    envelope: SaveGameEnvelope<TInput>,
    context: SaveGameMigrationContext,
) => SaveGameEnvelope<TOutput>;

export interface SaveGameEnvelope<T extends SaveGamePayload = SaveGamePayload> {
    schemaVersion: number;
    savedAt: string;
    payload: T;
}

export interface SaveGameReadResult<T extends SaveGamePayload = SaveGamePayload> {
    slotName: string;
    userIndex: number;
    exists: boolean;
    envelope?: SaveGameEnvelope<T>;
}

export class SaveGameService {
    private readonly activeAsyncActions = new Set<UE.AsyncActionHandleSaveGame>();

    constructor(private readonly worldContextObject?: UE.Object) {}

    exists(slotName: string, options: SaveGameSlotOptions = {}): boolean {
        return UE.GameplayStatics.DoesSaveGameExist(this.requireSlotName(slotName), this.getUserIndex(options));
    }

    delete(slotName: string, options: SaveGameSlotOptions = {}): boolean {
        return UE.GameplayStatics.DeleteGameInSlot(this.requireSlotName(slotName), this.getUserIndex(options));
    }

    saveJson<T extends SaveGamePayload>(slotName: string, payload: T, options: SaveJsonOptions = {}): boolean {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        const envelope = this.createEnvelope(payload, options);
        const saveGame = this.createJsonSaveGame(envelope);
        return UE.GameplayStatics.SaveGameToSlot(saveGame, normalizedSlotName, userIndex);
    }

    saveJsonAsync<T extends SaveGamePayload>(slotName: string, payload: T, options: SaveJsonOptions = {}): Promise<boolean> {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        const saveGame = this.createJsonSaveGame(this.createEnvelope(payload, options));
        const action = UE.AsyncActionHandleSaveGame.AsyncSaveGameToSlot(this.requireWorldContextObject(), saveGame, normalizedSlotName, userIndex);
        return this.runAsyncAction(action, normalizedSlotName).then((result) => result.success);
    }

    loadJson<T extends SaveGamePayload = SaveGamePayload>(slotName: string, options: LoadJsonOptions = {}): SaveGameReadResult<T> {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        if (!UE.GameplayStatics.DoesSaveGameExist(normalizedSlotName, userIndex)) {
            return { slotName: normalizedSlotName, userIndex, exists: false };
        }

        const saveGame = UE.GameplayStatics.LoadGameFromSlot(normalizedSlotName, userIndex) as UE.UEHperJsonSaveGame | undefined;
        if (!saveGame) {
            throw new Error(`SaveGame load failed: ${normalizedSlotName}`);
        }

        const envelope = this.applySchemaExpectation<T>(normalizedSlotName, userIndex, this.parseEnvelope<T>(normalizedSlotName, saveGame), options);

        return { slotName: normalizedSlotName, userIndex, exists: true, envelope };
    }

    async loadJsonAsync<T extends SaveGamePayload = SaveGamePayload>(slotName: string, options: LoadJsonOptions = {}): Promise<SaveGameReadResult<T>> {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        if (!UE.GameplayStatics.DoesSaveGameExist(normalizedSlotName, userIndex)) {
            return { slotName: normalizedSlotName, userIndex, exists: false };
        }

        const action = UE.AsyncActionHandleSaveGame.AsyncLoadGameFromSlot(this.requireWorldContextObject(), normalizedSlotName, userIndex);
        const result = await this.runAsyncAction(action, normalizedSlotName);
        if (!result.success || !result.saveGame) {
            throw new Error(`SaveGame async load failed: ${normalizedSlotName}`);
        }

        const saveGame = result.saveGame as UE.UEHperJsonSaveGame | undefined;
        if (!saveGame) {
            throw new Error(`SaveGame async load returned an unexpected object: ${normalizedSlotName}`);
        }

        const envelope = this.applySchemaExpectation<T>(normalizedSlotName, userIndex, this.parseEnvelope<T>(normalizedSlotName, saveGame), options);
        return { slotName: normalizedSlotName, userIndex, exists: true, envelope };
    }

    loadOrDefault<T extends SaveGamePayload>(slotName: string, defaults: T, options: LoadJsonOptions = {}): T {
        const result = this.loadJson<T>(slotName, options);
        return result.envelope?.payload ?? defaults;
    }

    async loadOrDefaultAsync<T extends SaveGamePayload>(slotName: string, defaults: T, options: LoadJsonOptions = {}): Promise<T> {
        const result = await this.loadJsonAsync<T>(slotName, options);
        return result.envelope?.payload ?? defaults;
    }

    getWorldContextObject(): UE.Object | undefined {
        return this.worldContextObject;
    }

    private createJsonSaveGame<T extends SaveGamePayload>(envelope: SaveGameEnvelope<T>): UE.UEHperJsonSaveGame {
        const saveGameClass = this.getJsonSaveGameClass();
        const saveGame = UE.GameplayStatics.CreateSaveGameObject(saveGameClass) as UE.UEHperJsonSaveGame | undefined;
        if (!saveGame) {
            throw new Error('UEHperJsonSaveGame creation failed.');
        }

        saveGame.SchemaVersion = envelope.schemaVersion;
        saveGame.PayloadJson = JSON.stringify(envelope);
        return saveGame;
    }

    private createEnvelope<T extends SaveGamePayload>(payload: T, options: SaveJsonOptions): SaveGameEnvelope<T> {
        return {
            schemaVersion: options.schemaVersion ?? 1,
            savedAt: new Date().toISOString(),
            payload,
        };
    }

    private parseEnvelope<T extends SaveGamePayload>(slotName: string, saveGame: UE.UEHperJsonSaveGame): SaveGameEnvelope<T> {
        if (typeof saveGame.PayloadJson !== 'string' || saveGame.PayloadJson.length === 0) {
            throw new Error(`SaveGame payload is empty: ${slotName}`);
        }

        const parsed = JSON.parse(saveGame.PayloadJson) as SaveGameEnvelope<T>;
        if (typeof parsed.schemaVersion !== 'number' || typeof parsed.savedAt !== 'string' || typeof parsed.payload !== 'object' || parsed.payload == null) {
            throw new Error(`SaveGame payload is invalid: ${slotName}`);
        }

        return parsed;
    }

    private applySchemaExpectation<T extends SaveGamePayload>(slotName: string, userIndex: number, envelope: SaveGameEnvelope<T>, options: LoadJsonOptions): SaveGameEnvelope<T> {
        if (options.expectedSchemaVersion == null || envelope.schemaVersion === options.expectedSchemaVersion) {
            return envelope;
        }

        if (!options.migrate) {
            throw new Error(`SaveGame schema mismatch: ${slotName}. expected=${options.expectedSchemaVersion} actual=${envelope.schemaVersion}`);
        }

        const migrated = options.migrate(envelope, {
            slotName,
            userIndex,
            fromSchemaVersion: envelope.schemaVersion,
            toSchemaVersion: options.expectedSchemaVersion,
        }) as SaveGameEnvelope<T>;

        if (migrated.schemaVersion !== options.expectedSchemaVersion) {
            throw new Error(`SaveGame migration failed: ${slotName}. expected=${options.expectedSchemaVersion} actual=${migrated.schemaVersion}`);
        }

        if (typeof migrated.savedAt !== 'string' || typeof migrated.payload !== 'object' || migrated.payload == null) {
            throw new Error(`SaveGame migration produced an invalid envelope: ${slotName}`);
        }

        return migrated;
    }

    private runAsyncAction(action: UE.AsyncActionHandleSaveGame, slotName: string): Promise<{ saveGame?: UE.SaveGame; success: boolean }> {
        if (!action) {
            return Promise.reject(new Error(`SaveGame async action creation failed: ${slotName}`));
        }

        this.activeAsyncActions.add(action);
        return new Promise((resolve, reject) => {
            const callback = (saveGame: UE.SaveGame | undefined, success: boolean): void => {
                cleanup();
                resolve({ saveGame, success });
            };
            const delegate = toManualReleaseDelegate(callback);
            const cleanup = (): void => {
                action.Completed.Remove(delegate as any);
                releaseManualReleaseDelegate(callback);
                this.activeAsyncActions.delete(action);
            };

            try {
                action.Completed.Add(delegate as any);
                action.Activate();
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    private requireWorldContextObject(): UE.Object {
        if (!this.worldContextObject) {
            throw new Error('WorldContextObject is required for async SaveGame operations.');
        }
        return this.worldContextObject;
    }

    private getJsonSaveGameClass(): UE.Class {
        const saveGameClass = UE.UEHperJsonSaveGame.StaticClass();
        if (!saveGameClass) {
            throw new Error('UEHperJsonSaveGame class is not available. Rebuild UEHper and regenerate typings if needed.');
        }
        return saveGameClass;
    }

    private requireSlotName(slotName: string): string {
        const normalized = slotName?.trim();
        if (!normalized) {
            throw new Error('SaveGame slotName is empty.');
        }
        return normalized;
    }

    private getUserIndex(options: SaveGameSlotOptions): number {
        return options.userIndex ?? 0;
    }

    dispose(): void {
        this.activeAsyncActions.clear();
    }
}
