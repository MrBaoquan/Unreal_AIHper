import * as UE from 'ue';
class UEHelpers {
    public static DisableScreenMessages(world: UE.World) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, 'DisableAllScreenMessages');
    }

    public static EnableScreenMessages(world: UE.World) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, 'EnableAllScreenMessages');
    }

    public static ExecuteConsoleCommand(world: UE.World, command: string) {
        UE.KismetSystemLibrary.ExecuteConsoleCommand(world, command);
    }
}

export default UEHelpers;
