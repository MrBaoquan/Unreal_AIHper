"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SaveGameService = void 0;
const puerts_1 = require("puerts");
const UE = require("ue");
class SaveGameService {
    constructor(worldContextObject) {
        this.worldContextObject = worldContextObject;
        this.activeAsyncActions = new Set();
    }
    exists(slotName, options = {}) {
        return UE.GameplayStatics.DoesSaveGameExist(this.requireSlotName(slotName), this.getUserIndex(options));
    }
    delete(slotName, options = {}) {
        return UE.GameplayStatics.DeleteGameInSlot(this.requireSlotName(slotName), this.getUserIndex(options));
    }
    saveJson(slotName, payload, options = {}) {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        const envelope = this.createEnvelope(payload, options);
        const saveGame = this.createJsonSaveGame(envelope);
        return UE.GameplayStatics.SaveGameToSlot(saveGame, normalizedSlotName, userIndex);
    }
    saveJsonAsync(slotName, payload, options = {}) {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        const saveGame = this.createJsonSaveGame(this.createEnvelope(payload, options));
        const action = UE.AsyncActionHandleSaveGame.AsyncSaveGameToSlot(this.requireWorldContextObject(), saveGame, normalizedSlotName, userIndex);
        return this.runAsyncAction(action, normalizedSlotName).then((result) => result.success);
    }
    loadJson(slotName, options = {}) {
        const normalizedSlotName = this.requireSlotName(slotName);
        const userIndex = this.getUserIndex(options);
        if (!UE.GameplayStatics.DoesSaveGameExist(normalizedSlotName, userIndex)) {
            return { slotName: normalizedSlotName, userIndex, exists: false };
        }
        const saveGame = UE.GameplayStatics.LoadGameFromSlot(normalizedSlotName, userIndex);
        if (!saveGame) {
            throw new Error(`SaveGame load failed: ${normalizedSlotName}`);
        }
        const envelope = this.applySchemaExpectation(normalizedSlotName, userIndex, this.parseEnvelope(normalizedSlotName, saveGame), options);
        return { slotName: normalizedSlotName, userIndex, exists: true, envelope };
    }
    async loadJsonAsync(slotName, options = {}) {
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
        const saveGame = result.saveGame;
        if (!saveGame) {
            throw new Error(`SaveGame async load returned an unexpected object: ${normalizedSlotName}`);
        }
        const envelope = this.applySchemaExpectation(normalizedSlotName, userIndex, this.parseEnvelope(normalizedSlotName, saveGame), options);
        return { slotName: normalizedSlotName, userIndex, exists: true, envelope };
    }
    loadOrDefault(slotName, defaults, options = {}) {
        const result = this.loadJson(slotName, options);
        return result.envelope?.payload ?? defaults;
    }
    async loadOrDefaultAsync(slotName, defaults, options = {}) {
        const result = await this.loadJsonAsync(slotName, options);
        return result.envelope?.payload ?? defaults;
    }
    getWorldContextObject() {
        return this.worldContextObject;
    }
    createJsonSaveGame(envelope) {
        const saveGameClass = this.getJsonSaveGameClass();
        const saveGame = UE.GameplayStatics.CreateSaveGameObject(saveGameClass);
        if (!saveGame) {
            throw new Error('UEHperJsonSaveGame creation failed.');
        }
        saveGame.SchemaVersion = envelope.schemaVersion;
        saveGame.PayloadJson = JSON.stringify(envelope);
        return saveGame;
    }
    createEnvelope(payload, options) {
        return {
            schemaVersion: options.schemaVersion ?? 1,
            savedAt: new Date().toISOString(),
            payload,
        };
    }
    parseEnvelope(slotName, saveGame) {
        if (typeof saveGame.PayloadJson !== 'string' || saveGame.PayloadJson.length === 0) {
            throw new Error(`SaveGame payload is empty: ${slotName}`);
        }
        const parsed = JSON.parse(saveGame.PayloadJson);
        if (typeof parsed.schemaVersion !== 'number' || typeof parsed.savedAt !== 'string' || typeof parsed.payload !== 'object' || parsed.payload == null) {
            throw new Error(`SaveGame payload is invalid: ${slotName}`);
        }
        return parsed;
    }
    applySchemaExpectation(slotName, userIndex, envelope, options) {
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
        });
        if (migrated.schemaVersion !== options.expectedSchemaVersion) {
            throw new Error(`SaveGame migration failed: ${slotName}. expected=${options.expectedSchemaVersion} actual=${migrated.schemaVersion}`);
        }
        if (typeof migrated.savedAt !== 'string' || typeof migrated.payload !== 'object' || migrated.payload == null) {
            throw new Error(`SaveGame migration produced an invalid envelope: ${slotName}`);
        }
        return migrated;
    }
    runAsyncAction(action, slotName) {
        if (!action) {
            return Promise.reject(new Error(`SaveGame async action creation failed: ${slotName}`));
        }
        this.activeAsyncActions.add(action);
        return new Promise((resolve, reject) => {
            const callback = (saveGame, success) => {
                cleanup();
                resolve({ saveGame, success });
            };
            const delegate = (0, puerts_1.toManualReleaseDelegate)(callback);
            const cleanup = () => {
                action.Completed.Remove(delegate);
                (0, puerts_1.releaseManualReleaseDelegate)(callback);
                this.activeAsyncActions.delete(action);
            };
            try {
                action.Completed.Add(delegate);
                action.Activate();
            }
            catch (error) {
                cleanup();
                reject(error);
            }
        });
    }
    requireWorldContextObject() {
        if (!this.worldContextObject) {
            throw new Error('WorldContextObject is required for async SaveGame operations.');
        }
        return this.worldContextObject;
    }
    getJsonSaveGameClass() {
        const saveGameClass = UE.UEHperJsonSaveGame.StaticClass();
        if (!saveGameClass) {
            throw new Error('UEHperJsonSaveGame class is not available. Rebuild UEHper and regenerate typings if needed.');
        }
        return saveGameClass;
    }
    requireSlotName(slotName) {
        const normalized = slotName?.trim();
        if (!normalized) {
            throw new Error('SaveGame slotName is empty.');
        }
        return normalized;
    }
    getUserIndex(options) {
        return options.userIndex ?? 0;
    }
    dispose() {
        this.activeAsyncActions.clear();
    }
}
exports.SaveGameService = SaveGameService;
//# sourceMappingURL=SaveGameService.js.map