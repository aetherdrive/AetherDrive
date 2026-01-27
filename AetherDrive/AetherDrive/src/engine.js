// AetherDrive - Motoren v3
const { helper } = require('./utils');
const config = require('./config');

class Engine {
    constructor(name) {
        this.name = name || 'AetherDrive';
        this.status = 'stopped';
    }

    start() {
        this.status = 'running';
        console.log(`${this.name} is now ${this.status}.`);
    }

    stop() {
        this.status = 'stopped';
        console.log(`${this.name} has ${this.status}.`);
    }

    runTask(taskName) {
        console.log(`Running task: ${taskName}`);
        helper(taskName);
    }
}

if (require.main === module) {
    const engine = new Engine();
    engine.start();
    engine.runTask('Initial Setup');
}

module.exports = Engine;