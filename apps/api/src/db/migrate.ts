import { readConfig } from '../config.js';
import { openDatabase } from './index.js';

openDatabase(readConfig()).close();
console.log('Local database migrations applied.');
