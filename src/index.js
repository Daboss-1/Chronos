// Main Application Entry Point
// Initializes dashboard and manages global state

class DashboardState {
    constructor() {
        this.selectedAuto = null;
        this.matchStats = null;
        this.fmsData = null;
        this.telemetry = {};
    }

    updateFMSData(data) {
        this.fmsData = data;
    }

    updateTelemetry(data) {
        this.telemetry = { ...this.telemetry, ...data };
    }

    reset() {
        this.selectedAuto = null;
        this.matchStats = null;
        this.telemetry = {};
    }
}

// Initialize global dashboard state
window.dashboardState = new DashboardState();

// Application initialization
document.addEventListener('DOMContentLoaded', () => {
    // console.log('FRC Dashboard initialized');
    // console.log('Team 172 - Northern Force');
    // console.log('Reefscape 2025');

    // All modules are already initialized via their own scripts
    // This is just for any final setup or logging

    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Debug shortcuts (remove in production)
        if (e.ctrlKey && e.shiftKey) {
            switch (e.key) {
                case '1':
                    window.stageManager.goToStage('autoSelection');
                    break;
                case '2':
                    window.stageManager.goToStage('confirmation');
                    break;
                case '3':
                    window.stageManager.goToStage('autonomous');
                    break;
                case '4':
                    window.stageManager.goToStage('teleop');
                    break;
                case '5':
                    window.stageManager.goToStage('postGame');
                    break;
                case 'R':
                    window.dashboardState.reset();
                    window.stageManager.goToStage('autoSelection');
                    break;
            }
        }
    });

    // Display keyboard shortcuts info
    // console.log('Keyboard shortcuts (Debug):');
    // console.log('Ctrl+Shift+1-5: Jump to stage');
    // console.log('Ctrl+Shift+R: Reset dashboard');
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // console.log('Dashboard hidden');
    } else {
        // console.log('Dashboard visible');
        // Could request fresh data here
    }
});

// Prevent accidental page closure during match
window.addEventListener('beforeunload', (e) => {
    const stage = window.stageManager?.getCurrentStage();
    if (stage === 'autonomous' || stage === 'teleop') {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});
