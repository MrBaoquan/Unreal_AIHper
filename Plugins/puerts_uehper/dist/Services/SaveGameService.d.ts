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
export type SaveGameMigration<TInput extends SaveGamePayload = SaveGamePayload, TOutput extends SaveGamePayload = SaveGamePayload> = (envelope: SaveGameEnvelope<TInput>, context: SaveGameMigrationContext) => SaveGameEnvelope<TOutput>;
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
export declare class SaveGameService {
    private readonly worldContextObject?;
    private readonly activeAsyncActions;
    constructor(worldContextObject?: UE.Object);
    exists(slotName: string, options?: SaveGameSlotOptions): boolean;
    delete(slotName: string, options?: SaveGameSlotOptions): boolean;
    saveJson<T extends SaveGamePayload>(slotName: string, payload: T, options?: SaveJsonOptions): boolean;
    saveJsonAsync<T extends SaveGamePayload>(slotName: string, payload: T, options?: SaveJsonOptions): Promise<boolean>;
    loadJson<T extends SaveGamePayload = SaveGamePayload>(slotName: string, options?: LoadJsonOptions): SaveGameReadResult<T>;
    loadJsonAsync<T extends SaveGamePayload = SaveGamePayload>(slotName: string, options?: LoadJsonOptions): Promise<SaveGameReadResult<T>>;
    loadOrDefault<T extends SaveGamePayload>(slotName: string, defaults: T, options?: LoadJsonOptions): T;
    loadOrDefaultAsync<T extends SaveGamePayload>(slotName: string, defaults: T, options?: LoadJsonOptions): Promise<T>;
    getWorldContextObject(): UE.Object | undefined;
    private createJsonSaveGame;
    private createEnvelope;
    private parseEnvelope;
    private applySchemaExpectation;
    private runAsyncAction;
    private requireWorldContextObject;
    private getJsonSaveGameClass;
    private requireSlotName;
    private getUserIndex;
    dispose(): void;
}
//# sourceMappingURL=SaveGameService.d.ts.map