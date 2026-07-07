import * as UE from 'ue';
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
export declare function getWidgetAnimation(widget: UE.UserWidget, animationName: string): UE.WidgetAnimation | undefined;
export declare function playWidgetAnimationByNameTransition(widget: UE.UserWidget, animationName: string, options?: UIAnimationTransitionOptions): UIAnimationTransitionTask;
export declare function playWidgetAnimationForwardTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options?: UIAnimationTransitionOptions): UIAnimationTransitionTask;
export declare function playWidgetAnimationReverseTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options?: UIAnimationTransitionOptions): UIAnimationTransitionTask;
export declare function playWidgetAnimationTransition(widget: UE.UserWidget, animation: UE.WidgetAnimation, options?: UIAnimationTransitionOptions): UIAnimationTransitionTask;
//# sourceMappingURL=UIAnimation.d.ts.map