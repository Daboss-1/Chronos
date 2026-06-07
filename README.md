# Chronos

Chronos is the FRC Driver Station Dashboard for Team 172. It is a standalone macOS desktop application built with Electron and React that connects directly to the robot over NetworkTables 4 (NT4). It replaces the default Shuffleboard/SmartDashboard workflow with a structured, stage-driven match flow, real-time telemetry panels, keybind-based robot control, match recording, and offline log replay.

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [Development](#development)
- [Robot Address Configuration](#robot-address-configuration)
- [Match Flow](#match-flow)
- [Dashboard Features](#dashboard-features)
- [Backend Integration (Java)](#backend-integration-java)
  - [Setup](#setup)
  - [Autonomous Routines](#autonomous-routines)
  - [Commands](#commands)
  - [Keybinds](#keybinds)
  - [Telemetry Values](#telemetry-values)
  - [Tunable Parameters](#tunable-parameters)
  - [Camera Streams](#camera-streams)
  - [Pre-Match Checklist](#pre-match-checklist)
  - [Battery Voltage](#battery-voltage)
  - [Dashboard Light](#dashboard-light)
  - [Systems API (Subsystem Grouping)](#systems-api-subsystem-grouping)
  - [Annotation-Based Registration](#annotation-based-registration)
  - [Field and Robot Pose](#field-and-robot-pose)
  - [Selected Autonomous](#selected-autonomous)
- [NT4 Topic Reference](#nt4-topic-reference)
- [Project Structure](#project-structure)
- [Build and Packaging](#build-and-packaging)

---

## Requirements

**Dashboard (macOS)**

- macOS 11 (Big Sur) or later, arm64 or x86-64
- Node.js 20 or later (for building from source)
- npm 10 or later

**Robot (Java)**

- WPILib 2025 or later
- PathPlanner (for autonomous path preview and sync)
- The `Dashboard.java` subsystem class from `frc.robot.lobby.subsystems.nfrdashboard`

---

## Installation

### From the release DMG (recommended)

1. Open `Chronos-1.0.0-universal.dmg` from the `release/` directory.
2. Drag `Chronos.app` to `/Applications`.
3. On first launch, macOS will block the app because it is not notarized. Clear this with:

```bash
xattr -cr /Applications/Chronos.app
```

4. Open Chronos from Finder or Spotlight.

### From source

```bash
git clone <repo-url>
cd Chronos
npm install --legacy-peer-deps
npm run dist:mac
```

The built `.app` and `.dmg` will appear in `release/`.

---

## Running the App

Double-click `Chronos.app` in `/Applications` or `release/mac-universal/`.

On launch the app will:

1. Auto-discover the robot by probing TCP port 5810 on each of the following addresses in order: `10.1.72.2`, `roboRIO-172-FRC.local`, `localhost`, `127.0.0.1`.
2. Establish an NT4 WebSocket connection directly to the resolved address.
3. Start the `sync-paths` background process, which watches NT for PathPlanner auto files and syncs them locally.
4. Open the Checklist stage, which waits for the robot to publish its pre-match status.

No Terminal window is required. Everything runs inside the `.app`.

---

## Development

To run the app with Vite hot-module reloading and Electron side-by-side:

```bash
cd Chronos
npm run dev
```

This starts the Vite dev server on port 5173 and launches Electron pointed at it. DevTools open automatically in a detached window.

**Available scripts**

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server + Electron with HMR and DevTools |
| `npm run build` | Production Vite build to `dist/` |
| `npm run dist:mac` | Vite build then electron-builder universal macOS package |

---

## Robot Address Configuration

The resolved robot address is shown in the header as a small button. Click it to open the address panel.

- **Connect** — enter any hostname or IP and press Connect (e.g., `10.1.72.2`, `roboRIO-172-FRC.local`, `192.168.1.50`). The setting is saved and persists across restarts.
- **Auto-Discover** — clears the override and re-runs the probe sequence.

The setting is also accessible from the **Robot** menu in the macOS menu bar.

Simulation (WPILib `Simulation` mode) is automatically reached at `localhost` when no field robot is available.

---

## Match Flow

Chronos enforces a linear pre-match workflow that mirrors the steps a drive team follows at a real event.

```
Checklist  ->  Auto Selection  ->  Confirmation  ->  Autonomous  ->  Teleop  ->  Post-Game
```

| Stage | Purpose |
|---|---|
| **Checklist** | Displays health status items published by the robot. All items must be `ok` before proceeding, or the driver can override. |
| **Auto Selection** | Lists PathPlanner routines discovered from NT. Shows a 2D field preview with animated path. Sends the selection back to the robot. |
| **Confirmation** | Reviews match info from FMS (event, match type, alliance, station, game message). Advances automatically when FMS signals match start. |
| **Autonomous** | 20-second autonomous period. Shows field map with robot pose, path overlay, auto routine name, subsystem status, and NT controls panel. Transitions to Teleop when FMS leaves autonomous. |
| **Teleop** | 140-second teleop period. Shows field map, match phase (Shift 1-4, Endgame), hub active/inactive state, scoring counter, and NT controls. Plays audio cues at 30 s, 10 s, and 0 s. Transitions to Post-Game when FMS disables the robot. |
| **Post-Game** | Displays match score summary. Download or replay the match recording. Upload external `.wpilog` or `.json` files for replay. |

The dashboard tabs in the header (Driver, Developer, SysId, etc.) are discovered dynamically from NT and can be accessed at any point during the match.

---

## Dashboard Features

**Live ring-buffer rewind**
The RewindBar at the bottom of the screen maintains a 3-minute rolling buffer of all NT values sampled at 20 Hz. Drag the scrubber left to go back in time. All panels reflect the historical values at the selected timestamp. Click "Live" to return to real-time.

**Match recording**
When Autonomous begins, Chronos starts recording all `/NFRDashboard/` and `/Robot/` NT topics at 20 Hz into a WPILog v1 binary file. Up to 10 recordings are kept in app storage.

**Log replay**
In Post-Game, or from the header upload button, upload a `.wpilog` (robot recording) or `.json` (dashboard export) file. The log viewer provides a full scrubber, playback at 0.25x–4x speed, and a FieldMap-based pose replay. Log replay is also accessible from the Log View button in the header at any time.

**Drag-and-drop widget layout**
The Autonomous and Teleop stages, and all discovered NT tabs, use a drag-and-resize grid layout. Click "Edit Layout" in the header to enter edit mode. Layouts are persisted per stage in app storage.

**Graph panels**
Any NT number value can be dropped onto a Graph panel to plot it over time. Window sizes of 10 s, 30 s, 60 s, and 120 s are available. Graph configurations are saved per panel.

**Keybinds panel**
The Keybinds tab shows all keys the robot has registered via `putKeybind`. Each key displays its description and running state. Holding a key in Chronos publishes `pressed = true` to NT; releasing publishes `pressed = false`. Multiple keys can be held simultaneously.

**Camera streams**
Camera streams registered via `putCameraStream` or `putLimelightStream` appear in the Camera Switcher panel. Click a thumbnail to open a fullscreen overlay.

**Alerts overlay**
Toast notifications appear on-screen when the robot publishes an alert via `putAlert`. Alerts auto-dismiss after 6 seconds.

**Theme and language**
Dark, light, and high-contrast themes are available from the theme button in the header. English, Spanish, and Portuguese translations are available from the language button.

---

## Backend Integration (Java)

### Setup

`Dashboard` is a WPILib `SubsystemBase` singleton. Register it with the `CommandScheduler` by adding it to your robot container. Its `periodic()` method handles all NT writes and reads each robot loop iteration.

```java
// In RobotContainer or your container class constructor:
private final Dashboard dashboard = Dashboard.INSTANCE;

// Register subsystem (required for periodic() to run)
// Dashboard extends SubsystemBase, so CommandScheduler picks it up automatically.
```

Because `Dashboard.INSTANCE` is `static final`, it is safe to access from any class without passing a reference:

```java
Dashboard.INSTANCE.putNumber("Driver", "Flywheel RPM", () -> shooter.getRPM());
```

All registrations (`putCommand`, `putNumber`, etc.) must be called during robot initialization, not from `periodic()`. Each method is idempotent — calling it a second time with the same key is a no-op.

---

### Autonomous Routines

Register PathPlanner autos to make them appear in the Auto Selection stage. The dashboard detects `PathPlannerAuto` instances and reads the `.auto` file to generate a path preview.

```java
// Register the default routine (pre-selected on dashboard open)
dashboard.putDefaultAutonomousCommand(
    "S1-DEPOT",
    "Starts under left trench and empties depot.",
    new PathPlannerAuto("S1-DEPOT")
);

// Register additional routines
dashboard.putAutonomousCommand(
    "S2-CLIMB",
    "Starts center, shoots loaded balls, climbs left post.",
    new PathPlannerAuto("S2-CLIMB")
);
```

Retrieve the driver's selection at the start of autonomous:

```java
@Override
public Command getAutonomousCommand() {
    return dashboard.getSelectedAutonomousCommand();
}
```

The `sync-paths` process running inside Chronos watches NT for PathPlanner path references and copies `.auto` and `.path` files from the robot's deploy directory into the dashboard's local `public/` folder so the field preview renders offline during a match.

---

### Commands

Commands are displayed as buttons in any named tab. Clicking a button toggles the command (schedules it if idle, cancels it if running).

```java
// Simple command button
dashboard.putCommand("Driver", "Reset Turret",
    Commands.runOnce(() -> turret.resetAngle()).ignoringDisable(true)
);

// Specify a custom table path (advanced — use the two-arg form for a different NT root)
dashboard.putCommand("Driver", "/MyRobot", "Custom Command", myCommand);
```

The first argument is the **tab name** — this controls which tab the button appears in on the dashboard. Use any string; if the tab does not already exist it will be created automatically.

---

### Keybinds

Keybinds link a keyboard key (held down in Chronos) to a robot command. When the key is pressed, `onTrue` is scheduled. When released, `onFalse` is scheduled (if provided).

```java
// Key with only an onTrue handler
dashboard.putKeybind("space", "Shoot", shootCommand);

// Key with both press and release handlers
dashboard.putKeybind("w", "Drive forward",
    Commands.runOnce(() -> driveSpeed = 1.0),
    Commands.runOnce(() -> driveSpeed = 0.0)
);
```

The key string must match the browser `KeyboardEvent.key` value, lowercased. Common values:

| Key | String |
|---|---|
| Letter keys | `"a"` through `"z"` |
| Spacebar | `"space"` |
| Arrow keys | `"arrowup"`, `"arrowdown"`, `"arrowleft"`, `"arrowright"` |
| F-keys | `"f1"` through `"f12"` |
| Escape | `"escape"` |
| Enter | `"enter"` |
| Backspace | `"backspace"` |

Multiple keybinds can be active simultaneously. The robot reads each key's NT topic (`/NFRDashboard/commands/Keybinds/<key>/pressed`) independently every loop iteration, so holding `w`, `a`, and `arrowleft` at the same time works correctly.

**Reading key state in periodic code:**

The `pressed` boolean is available directly over NT if you need to read it outside of a Command:

```java
boolean wHeld = NetworkTableInstance.getDefault()
    .getTable("/NFRDashboard/commands/Keybinds/w")
    .getEntry("pressed")
    .getBoolean(false);
```

The `LobbyOI` integration pattern uses `putKeybind` with `Commands.runOnce` to flip a double field that is then consumed by the drive default command, enabling full WASD control of the drivetrain from the dashboard keyboard:

```java
// In LobbyContainer constructor:
dashboard.putKeybind("w", "Drive forward",  Commands.runOnce(() -> wKey = 1), Commands.runOnce(() -> wKey = 0));
dashboard.putKeybind("s", "Drive backward", Commands.runOnce(() -> sKey = 1), Commands.runOnce(() -> sKey = 0));
dashboard.putKeybind("a", "Strafe left",    Commands.runOnce(() -> aKey = 1), Commands.runOnce(() -> aKey = 0));
dashboard.putKeybind("d", "Strafe right",   Commands.runOnce(() -> dKey = 1), Commands.runOnce(() -> dKey = 0));
dashboard.putKeybind("j", "Rotate left",    Commands.runOnce(() -> arrowLeft = 1),  Commands.runOnce(() -> arrowLeft = 0));
dashboard.putKeybind("l", "Rotate right",   Commands.runOnce(() -> arrowRight = 1), Commands.runOnce(() -> arrowRight = 0));

// In LobbyOI.bind():
drive.setDefaultCommand(drive.driveByJoystick(
    () -> container.getDTrig() - container.getATrig(),
    () -> container.getWTrig() - container.getSTrig(),
    () -> container.getArrowLeft() - container.getArrowRight()
));
```

---

### Telemetry Values

Read-only values displayed in the Values panel of any tab.

```java
// Publish a number updated every loop
dashboard.putNumber("Driver", "Shooter RPM", () -> shooter.getRPM());

// Publish a boolean
dashboard.putBoolean("Developer", "Intake Deployed", () -> intake.isDeployed());

// Publish a string
dashboard.putString("Driver", "Robot State", () -> stateMachine.getCurrentState().name());

// With a custom NT table root (advanced overload)
dashboard.putNumber("Developer", "/MyCustomTable", "Voltage", () -> pdh.getVoltage());
```

---

### Tunable Parameters

Tunables appear as editable inputs in the Tunables panel. When the driver changes a value and submits it, `runOnChange` is called on the robot with the new value.

```java
// Number tunable
dashboard.putNumberTunable("Developer", "Shooter P Gain", 0.5, kP -> {
    shooter.setPGain(kP);
});

// Boolean toggle
dashboard.putBooleanTunable("Developer", "Brake Mode", false, brake -> {
    drivetrain.setBrakeMode(brake);
});

// String tunable
dashboard.putStringTunable("Developer", "Auto Strategy", "default", strategy -> {
    autoSelector.setStrategy(strategy);
});
```

Tunables use a `changed` flag handshake. The robot sets `changed = false` after consuming the new value. The dashboard will not allow re-submission until the robot acknowledges the previous change. This prevents dropped updates over a lossy connection.

---

### Camera Streams

Camera streams appear in the Camera Switcher panel of the specified tab. Click a stream to open it fullscreen.

```java
// Register a Limelight (automatically constructs the URL from mDNS name)
dashboard.putLimelightStream("Developer", "limelight-front");
// Published URL: http://limelight-front.local:5800

// Register any MJPEG stream
dashboard.putCameraStream("Driver", "Intake Cam", "http://10.1.72.11:1181/stream.mjpg");
```

---

### Pre-Match Checklist

Checklist items appear on the Checklist stage before the match. Each item reports a status of `ok`, `warn`, `error`, or `unknown`. All items must be `ok` before the "All Clear" button is enabled (the driver can override).

```java
// Simple healthy/unhealthy check
dashboard.putChecklistItem("Drivetrain", () -> drivetrain.isCalibrated());

// With a dynamic message
dashboard.putChecklistItem("Vision", 
    () -> vision.isConnected(),
    () -> vision.isConnected() ? "Tracking " + vision.getTagCount() + " tags" : "No targets detected"
);

dashboard.putChecklistItem("Battery", 
    () -> pdh.getVoltage() >= 12.0,
    () -> String.format("%.1f V", pdh.getVoltage())
);
```

The status shown is:
- `ok` — supplier returns `true`
- `error` — supplier returns `false`

`warn` and `unknown` states are available for items that have not yet been evaluated (the topic is absent from NT).

---

### Battery Voltage

Registers a voltage supplier. The header battery indicator updates every loop.

```java
dashboard.putBatteryVoltage(() -> Volts.of(pdh.getVoltage()));
```

---

### Dashboard Light

Sets the background color of the entire dashboard. Useful for alliance color indication or match state signaling.

```java
// Set a static color
dashboard.setDashboardLight(Color.kBlue);

// Use as a command (e.g., in an auto routine or state machine)
Commands.sequence(
    dashboard.setDashboardLightCommand(Color.kGreen),
    shootCommand,
    dashboard.setDashboardLightCommand(Color.kBlue)
);
```

Passing a color with value `kBlack` or any color matching the background restores the default appearance. The transition animates over 120 ms.

---

### Systems API (Subsystem Grouping)

The Systems API groups related commands, tunables, and values under a named subsystem in the Systems panel. This is the cleanest way to expose an entire subsystem's interface without placing everything in a flat list.

```java
dashboard.putSystem("Developer", "Drivetrain")
    .withCommand("SysId Quasistatic Fwd", drive.sysIdQuasistaticTranslation(Direction.kForward))
    .withCommand("SysId Quasistatic Rev", drive.sysIdQuasistaticTranslation(Direction.kReverse))
    .withCommand("SysId Dynamic Fwd",     drive.sysIdDynamicTranslation(Direction.kForward))
    .withCommand("SysId Dynamic Rev",     drive.sysIdDynamicTranslation(Direction.kReverse))
    .withNumber("Left Velocity",   () -> drive.getLeftVelocity())
    .withNumber("Right Velocity",  () -> drive.getRightVelocity())
    .withBoolean("At Pose",        () -> drive.isAtTargetPose())
    .withNumberTunable("Max Speed", 3.5, v -> drive.setMaxSpeed(v))
    .withBooleanTunable("Brake Mode", true, b -> drive.setBrakeMode(b));

dashboard.putSystem("Developer", "Turret")
    .withCommand("Reset Angle", Commands.runOnce(() -> turret.resetAngle()))
    .withNumber("Angle Deg",    () -> turret.getAngle().in(Degrees))
    .withBoolean("At Target",   () -> turret.isAtTarget());
```

Each system appears as a collapsible card in the Systems panel. Its commands, tunables, and read values are grouped inside it.

---

### Annotation-Based Registration

`@DashboardTunable` and `@DashboardTunableConstants` are field-level and class-level annotations that automatically register matching fields as tunables when `dashboard.register(object)` is called.

```java
// Register all @DashboardTunable fields on a subsystem instance
dashboard.register(turret.getSuzie());

// Register all static fields in a constants class (pass the class itself)
dashboard.register(LobbyConstants.class);
```

Annotate individual fields:

```java
public class ShooterConstants {
    @DashboardTunable(name = "P Gain", tab = "Developer")
    public static double kP = 0.5;

    @DashboardTunable(name = "Target RPM", tab = "Driver")
    public static double kTargetRPM = 3500.0;
}
```

Annotate an entire class to register all its fields without annotating each one individually:

```java
@DashboardTunableConstants(name = "CarouselConstants", tab = "Developer")
public class CarouselConstants {
    public static double kSpeed = 0.7;
    public static double kGearRatio = 10.0;
    public static boolean kInverted = false;
}
```

Supported field types: `double`, `int`, `boolean`, `String`, `char`, `Angle` (WPILib), `Distance` (WPILib).

---

### Field and Robot Pose

Register a named field and one or more robot overlays for display on the dashboard's FieldMap widget.

```java
// Create a field and attach a robot
dashboard.putField("Driver", "Main Field")
    .withRobot("Lobby", () -> drive.getPose());

// Multiple robots on the same field (e.g., vision ghost robot)
dashboard.putField("Developer", "Vision Debug")
    .withRobot("Estimated",   () -> drive.getPose())
    .withRobot("Vision",      () -> vision.getVisionPose());
```

You can also call `putRobot` directly:

```java
dashboard.putRobot("Driver", "Main Field", "Opponent", () -> opponentPose);
```

The FieldMap widget redraws every loop at 20 Hz. Pose coordinates use the WPILib standard (meters, origin at the blue alliance wall corner).

---

### Selected Autonomous

The dashboard writes the driver's autonomous selection back to NT. Read it from the robot code:

```java
// In getAutonomousCommand():
return dashboard.getSelectedAutonomousCommand();
```

This looks up the command registered under the name stored at `/NFRDashboard/selectedAutonomous/Match`. If the name does not match any registered command, `Commands.none()` is returned.

---

## NT4 Topic Reference

All topics are under the `/NFRDashboard` root unless noted.

| Topic | Type | Direction | Description |
|---|---|---|---|
| `/NFRDashboard/commands/<tab>/<name>/running` | boolean | Robot → Dashboard | Whether the command is currently scheduled |
| `/NFRDashboard/commands/<tab>/<name>/requestId` | int | Dashboard → Robot | Incremented to toggle command |
| `/NFRDashboard/commands/<tab>/<name>/lastHandledRequestId` | int | Robot → Dashboard | Last requestId the robot acted on |
| `/NFRDashboard/commands/Keybinds/<key>/pressed` | boolean | Dashboard → Robot | True while the key is held |
| `/NFRDashboard/commands/Keybinds/<key>/running` | boolean | Robot → Dashboard | True while the bound command is running |
| `/NFRDashboard/numbers/<tab>/<name>/value` | double | Robot → Dashboard | Read-only number |
| `/NFRDashboard/strings/<tab>/<name>/value` | string | Robot → Dashboard | Read-only string |
| `/NFRDashboard/booleans/<tab>/<name>/value` | boolean | Robot → Dashboard | Read-only boolean |
| `/NFRDashboard/tunableNumbers/<tab>/<name>/value` | double | Bidirectional | Current tunable value |
| `/NFRDashboard/tunableNumbers/<tab>/<name>/changed` | boolean | Dashboard → Robot | Set true when driver submits a new value |
| `/NFRDashboard/tunableBooleans/<tab>/<name>/value` | boolean | Bidirectional | Current tunable value |
| `/NFRDashboard/tunableStrings/<tab>/<name>/value` | string | Bidirectional | Current tunable value |
| `/NFRDashboard/autonomousCommands/Match/<name>/PathPlannerPath` | string | Robot → Dashboard | Absolute path to `.auto` file |
| `/NFRDashboard/autonomousCommands/Match/<name>/ClassName` | string | Robot → Dashboard | Java class name of the command |
| `/NFRDashboard/autonomousCommands/Match/<name>/Description` | string | Robot → Dashboard | Human-readable description |
| `/NFRDashboard/selectedAutonomous/Match` | string | Bidirectional | Name of the selected auto routine |
| `/NFRDashboard/cameraStreams/<tab>/<name>/url` | string | Robot → Dashboard | MJPEG stream URL |
| `/NFRDashboard/checklist/<name>/status` | string | Robot → Dashboard | `ok`, `warn`, `error`, or `unknown` |
| `/NFRDashboard/checklist/<name>/message` | string | Robot → Dashboard | Optional status message |
| `/NFRDashboard/alerts/<name>/active` | boolean | Robot → Dashboard | Whether the alert is currently firing |
| `/NFRDashboard/battery/voltage` | double | Robot → Dashboard | Battery voltage in volts |
| `/NFRDashboard/dashboardLight/color` | string | Robot → Dashboard | Hex color string (e.g. `#0000ff`) |
| `/NFRDashboard/systems/<system>/commands/<tab>/<name>/...` | — | Bidirectional | Same structure as commands, scoped to system |
| `/NFRDashboard/robots/<tab>/<field>/<name>/x` | double | Robot → Dashboard | Robot pose X in meters |
| `/NFRDashboard/robots/<tab>/<field>/<name>/y` | double | Robot → Dashboard | Robot pose Y in meters |
| `/NFRDashboard/robots/<tab>/<field>/<name>/rotation` | double | Robot → Dashboard | Robot heading in degrees |

---

## Project Structure

```
Chronos/
├── electron/
│   ├── main.js          # Electron main process: BrowserWindow, IPC, robot auto-discovery, sync-paths
│   └── preload.js       # contextBridge: exposes window.electronAPI to renderer
├── src/
│   ├── App.jsx          # Root component: stage routing, keybind capture, dashboard light
│   ├── main.jsx         # React entry point: NT4Provider with dynamic robot address
│   ├── stages/          # One component per match stage
│   │   ├── Checklist.jsx
│   │   ├── AutoSelection.jsx
│   │   ├── Confirmation.jsx
│   │   ├── Autonomous.jsx
│   │   ├── Teleop.jsx
│   │   ├── PostGame.jsx
│   │   ├── NTTabView.jsx         # NT panel renderer (commands, tunables, values, cameras)
│   │   └── DeveloperDashboard.jsx
│   ├── components/      # Reusable UI components
│   │   ├── Header.jsx            # Top bar: tabs, alliance, battery, settings
│   │   ├── FieldMap.jsx          # Canvas-based 2D field with robot pose and paths
│   │   ├── WidgetGrid.jsx        # Drag-and-resize grid for Autonomous/Teleop stages
│   │   ├── NTTabWidgetGrid.jsx   # Drag-and-resize grid for discovered NT tabs
│   │   ├── GraphPanel.jsx        # Time-series graph with drag-and-drop NT values
│   │   ├── CameraSwitcher.jsx    # MJPEG camera thumbnails and fullscreen overlay
│   │   ├── AlertsOverlay.jsx     # Toast notification stack
│   │   ├── RewindBar.jsx         # Live ring-buffer timeline scrubber
│   │   ├── LogReplayBar.jsx      # Log file playback transport
│   │   ├── LogReplayDashboard.jsx # Full-screen log replay shell
│   │   ├── MatchReplayViewer.jsx # Post-game pose replay with FieldMap
│   │   └── DownloadMenu.jsx      # WPILog/JSON/PDF download FAB
│   ├── contexts/        # React context providers
│   │   ├── ThemeContext.jsx
│   │   ├── I18nContext.jsx
│   │   ├── LayoutContext.jsx
│   │   ├── RewindContext.jsx
│   │   └── LogReplayContext.jsx
│   ├── hooks/
│   │   ├── useMatchRecorder.js   # NT recording to WPILog v1
│   │   ├── useAdvantageScope.js  # AdvantageScope NT bridge
│   │   ├── useNTRingBuffer.js    # 3-minute rolling sample buffer
│   │   ├── useSoundCues.js       # Web Audio match milestone tones
│   │   ├── useDiscoveredTabs.js  # Scans NT for dashboard tab names
│   │   └── useEntryOrHistorical.js # Live/rewind value selector
│   ├── utils/
│   │   ├── pathLoader.js         # PathPlanner .auto/.path file parser and Bezier interpolation
│   │   ├── wpilog.js             # WPILog v1 encoder/decoder
│   │   ├── matchPhase.js         # Match shift/endgame phase calculator
│   │   ├── ntTabData.js          # NT topic tree parser for tab data
│   │   ├── pdfGenerator.jsx      # Auto-routine PDF export
│   │   └── icons.jsx             # Inline SVG icon components
│   ├── styles/
│   │   ├── main.css
│   │   ├── stages.css
│   │   └── features.css
│   └── i18n/
│       ├── en.json
│       ├── es.json
│       └── pt.json
├── scripts/
│   └── sync-paths.js    # NT4 watcher that copies PathPlanner files from robot to public/
├── public/
│   ├── field.png        # 2025 Reefscape field image
│   ├── autos/           # PathPlanner .auto files (synced from robot)
│   └── paths/           # PathPlanner .path files + automap.json (synced from robot)
├── build/               # electron-builder resources (icon.icns)
├── release/             # Packaged output (Chronos.app, Chronos.dmg)
├── index.html
├── vite.config.js
└── package.json
```

---

## Build and Packaging

```bash
# Development (HMR + Electron)
npm run dev

# Production Vite build only
npm run build

# Full macOS package (builds Vite then runs electron-builder)
npm run dist:mac
```

Output at `release/`:
- `Chronos-1.0.0-universal.dmg` — installer for distribution
- `mac-universal/Chronos.app` — app bundle for direct use

The app is built as a universal binary targeting both Apple Silicon (arm64) and Intel (x86-64) Macs.

Code signing is not configured. To distribute outside the team, you will need an Apple Developer ID certificate and to add `afterSign` notarization hooks to `electron-builder` configuration in `package.json`.
