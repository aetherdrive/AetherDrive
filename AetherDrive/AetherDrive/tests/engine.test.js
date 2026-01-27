const Engine = require('../src/engine');

const engine = new Engine('TestEngine');
engine.start();
engine.runTask('TestTask');
engine.stop();