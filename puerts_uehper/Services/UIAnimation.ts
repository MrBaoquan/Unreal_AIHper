import { releaseManualReleaseDelegate, toManualReleaseDelegate } from 'puerts';
import * as UE from 'ue';
import { OperationCanceledError } from '../Framework/Cancellation';
import type { UITransitionTask } from './UIService';

export interface UIAnimationTransitionOptions {
    startAtTime?: number;
    numLoopsToPlay?: number;
    playMode?: UE.EUMGSequencePlayMode;
    playbackSpeed?: number;
    restoreState?: boolean;
    stopOnCancel?: boolean;
}

export interface UIAnimationTransitionTask extends UITransitionTask {
    player?: UE.UMGSequencePlayer;
}

export function getWidgetAnimation(widget: UE.UserWidget, animationName: string): UE.WidgetAnimation | undefined {
    const directAnimation = (widget as any)[animationName] as UE.WidgetAnimation | undefined;
    if (directAnimation) {
        return directAnimation;
    }

    const generatedClass = widget.GetClass() as unknown as UE.WidgetBlueprintGeneratedClass;
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

export function playWidgetAnimationByNameTransition(widget: UE.UserWidget, animationName: string, options: UIAnimationTransitionOptions = {}): UIAnimationTransitionTask {
    const animation = getWidgetAnimation(widget, animationName);
    if (!animation) {
        throw new Error(`Widget animation not found: ${animationName}`);
    }

    return playWidgetAnimationTransition(widget, animation, options);
}

export function playWidgetAnimationForwardTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options: UIAnimationTransitionOptions = {}): UIAnimationTransitionTask {
    return playWidgetAnimationTransition(widget, animation, { ...options, playMode: UE.EUMGSequencePlayMode.Forward });
}

export function playWidgetAnimationReverseTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options: UIAnimationTransitionOptions = {}): UIAnimationTransitionTask {
    return playWidgetAnimationTransition(widget, animation, { ...options, playMode: UE.EUMGSequencePlayMode.Reverse });
}

export function playWidgetAnimationTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options: UIAnimationTransitionOptions = {}): UIAnimationTransitionTask {
    const numLoopsToPlay = options.numLoopsToPlay ?? 1;
    if (numLoopsToPlay === 0) {
        throw new Error('UI transition animation cannot use infinite loops.');
    }

    let player: UE.UMGSequencePlayer | undefined;
    let settled = false;
    let bound = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectPromise: ((reason?: unknown) => void) | undefined;

    const callback = (): void => {
        finish();
    };
    const delegate = toManualReleaseDelegate(callback) as any;

    const cleanup = (): void => {
        try {
            if (finishTimer) {
                clearTimeout(finishTimer);
                finishTimer = undefined;
            }
            if (bound) {
                widget.UnbindFromAnimationFinished(animation, delegate);
                bound = false;
            }
        } finally {
            releaseManualReleaseDelegate(callback);
        }
    };

    const finish = (): void => {
        if (settled) {
            return;
        }

        settled = true;
        cleanup();
        resolvePromise?.();
    };

    let resolvePromise: (() => void) | undefined;
    const promise = new Promise<void>((resolve, reject) => {
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
        } catch (error) {
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
            rejectPromise?.(new OperationCanceledError('UI animation transition canceled.'));
        },
    };
}
