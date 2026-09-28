#!/usr/bin/env node
// Prints a random 32-byte key (base64) for ENCRYPTION_KEY.
import { randomBytes } from 'node:crypto';
console.log(randomBytes(32).toString('base64'));
