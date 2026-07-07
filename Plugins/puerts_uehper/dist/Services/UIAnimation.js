"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.playWidgetAnimationTransition = exports.playWidgetAnimationReverseTransition = exports.playWidgetAnimationForwardTransition = exports.playWidgetAnimationByNameTransition = exports.getWidgetAnimation = void 0;
const puerts_1 = require("puerts");
const UE = require("ue");
const Cancellation_1 = require("../Framework/Cancellation");
function getWidgetAnimation(widget, animationName) {
    const directAnimation = widget[animationName];
    if (directAnimation) {
        return directAnimation;
    }
    const generatedClass = widget.GetClass();
    const animations = generatedClass?.Animations;
    if (!animations) {
        return undefined;
    }
    for (const animation of animations) {
        const objectName = animation.GetName();
        if (objectName === animationName || objectName === `${animationName}_INST` || animation.DisplayLabel === animationName) {
            return animation;
        }
    }
    return undefined;
}
exports.getWidgetAnimation = getWidgetAnimation;
function playWidgetAnimationByNameTransition(widget, animationName, options = {}) {
    const animation = getWidgetAnimation(widget, animationName);
    if (!animation) {
        throw new Error(`Widget animation not found: ${animationName}`);
    }
    return playWidgetAnimationTransition(widget, animation, options);
}
exports.playWidgetAnimationByNameTransition = playWidgetAnimationByNameTransition;
function playWidgetAnimationForwardTransition(widget, animation, options = {}) {
    return playWidgetAnimationTransition(widget, animation, { ...options, playMode: UE.EUMGSequencePlayMode.Forward });
}
exports.playWidgetAnimationForwardTransition = playWidgetAnimationForwardTransition;
function playWidgetAnimationReverseTransition(widget, animation, options = {}) {
    return playWidgetAnimationTransition(widget, animation, { ...options, playMode: UE.EUMGSequencePlayMode.Reverse });
}
exports.playWidgetAnimationReverseTransition = playWidgetAnimationReverseTransition;
function playWidgetAnimationTransition(widget, animation, options = {}) {
    const numLoopsToPlay = options.numLoopsToPlay ?? 1;
    if (numLoopsToPlay === 0) {
        throw new Error('UI transition animation cannot use infinite loops.');
    }
    let player;
    let settled = false;
    let bound = false;
    let finishTimer;
    let rejectPromise;
    const callback = () => {
        finish();
    };
    const delegate = (0, puerts_1.toManualReleaseDelegate)(callback);
    const cleanup = () => {
        try {
            if (finishTimer) {
                clearTimeout(finishTimer);
                finishTimer = undefined;
            }
            if (bound) {
                widget.UnbindFromAnimationFinished(animation, delegate);
                bound = false;
            }
        }
        finally {
            (0, puerts_1.releaseManualReleaseDelegate)(callback);
        }
    };
    const finish = () => {
        if (settled) {
            return;
        }
        settled = true;
        cleanup();
        resolvePromise?.();
    };
    let resolvePromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
        try {
            widget.BindToAnimationFinished(animation, delegate);
            bound = true;
            player = widget.PlayAnimation(animation, options.startAtTime ?? 0, numLoopsToPlay, options.playMode ?? UE.EUMGSequencePlayMode.Forward, options.playbackSpeed ?? 1, options.restoreState ?? false);
            const startAtTime = options.startAtTime ?? 0;
            const playbackSpeed = Math.abs(options.playbackSpeed ?? 1);
            const animationDuration = Math.max(0, animation.GetEndTime() - Math.max(animation.GetStartTime(), startAtTime));
            const fallbackMs = playbackSpeed > 0 ? Math.ceil((animationDuration * numLoopsToPlay * 1000) / playbackSpeed) + 50 : 0;
            finishTimer = setTimeout(finish, fallbackMs);
        }
        catch (error) {
            settled = true;
            cleanup();
            reject(error);
        }
    });
    return {
        get player() {
            return player;
        },
        promise,
        cancel: () => {
            if (settled) {
                return;
            }
            settled = true;
            if (options.stopOnCancel ?? true) {
                widget.StopAnimation(animation);
            }
            cleanup();
            rejectPromise?.(new Cancellation_1.OperationCanceledError('UI animation transition canceled.'));
        },
    };
}
exports.playWidgetAnimationTransition = playWidgetAnimationTransition;
//# sourceMappingURL=UIAnimation.js.map