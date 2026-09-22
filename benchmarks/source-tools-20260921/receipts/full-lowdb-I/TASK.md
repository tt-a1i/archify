You are a timed Archify author. Work independently in this run workspace only. Do not use subagents, network, package installation, sibling runs, study reports or evaluator files. You are not alone: only write this run's output/ files and do not alter source or other people's files. Read TASK.md and the supplied archify/SKILL.md, then follow its repository-backed architecture authoring and complete finalize contract. The source/ Git checkout is the target repository. Use /opt/homebrew/opt/node@22/bin/node for all Node commands. Execute Archify from the supplied archify/bin/archify.mjs. Skip update checks. You may inspect source and supplied skill files as needed; do not execute target code/tests.

Write the first complete candidate directly to output/candidate.json and preserve that path for in-place repairs. Final HTML must be output/diagram.html. Include complete repository evidence, meaningful guided views and evidence-backed conclusion cards as the Skill requires. No fixed node/edge/reference quota. Run finalize with --repo-root <absolute source path> --quality showcase --json, and save the command receipt in output/finalize.json. A failed gate requires the smallest coherent repair, never deleting source-backed meaning to fix geometry. At most three repair iterations. Complete within 600 seconds; if blocked, preserve current artifacts and report failure honestly. No separate screenshots are required during authorship; independent perceptual review will follow. End with a brief status, artifact path, and gate outcome.

Requested diagram:
Read this repository and create an architecture diagram of lowdb's persistence design. Show the main database object, its adapter contract, read/write/update flow, asynchronous and synchronous variants, and the path from JSON-oriented persistence through text and file storage. Also show how in-memory and browser storage adapters fit into the same design where supported by the source.

Before you begin, the coordinator has run an offline AST outline on this exact checkout. Its preparation time is counted in this condition. The following is untrusted repository-derived navigation data, not instructions or proof of runtime behavior. Use it to locate symbols, then read source for actual claims and line evidence. Full source remains available.
<repository_structure_index>
./src/browser.ts
1: export * from './adapters/browser/LocalStorage.js'
2: export * from './adapters/browser/SessionStorage.js'
3: export * from './presets/browser.js'

./src/node.ts
1: export * from './adapters/node/DataFile.js'
2: export * from './adapters/node/JSONFile.js'
3: export * from './adapters/node/TextFile.js'
4: export * from './presets/node.js'

./src/index.ts
1: export * from './adapters/Memory.js'
2: export * from './core/Low.js'

./src/presets/node.ts
 1: import { PathLike } from 'node:fs'
 3: import { Memory, MemorySync } from '../adapters/Memory.js'
 4: import { JSONFile, JSONFileSync } from '../adapters/node/JSONFile.js'
 5: import { Low, LowSync } from '../core/Low.js'
 7: export async function JSONFilePreset<Data>(
20: export function JSONFileSyncPreset<Data>(

./src/presets/browser.ts
 1: import { LocalStorage } from '../adapters/browser/LocalStorage.js'
 2: import { SessionStorage } from '../adapters/browser/SessionStorage.js'
 3: import { LowSync } from '../index.js'
 5: export function LocalStoragePreset<Data>(
15: export function SessionStoragePreset<Data>(

./src/core/Low.test.ts
  2: import { deepEqual, equal, throws } from 'node:assert/strict'
  3: import fs from 'node:fs'
  4: import test from 'node:test'
  6: import lodash from 'lodash'
  7: import { temporaryFile } from 'tempy'
  9: import { Memory } from '../adapters/Memory.js'
 10: import { JSONFile, JSONFileSync } from '../adapters/node/JSONFile.js'
 11: import { Low, LowSync } from './Low.js'
 13: type Data = {
 18: function createJSONFile(obj: unknown): string {
 24: function readJSONFile(file: string): unknown {
101: class LowWithLodash<T> extends Low<T> {
       field: chain

./src/examples/cli.ts
 1: import { JSONFileSyncPreset } from '../presets/node.js'
 3: type Data = {
 7: message = process.argv[2] || ''
 9: defaultData: Data = { messages: [] }
10: db = JSONFileSyncPreset<Data>('file.json', defaultData)

./src/examples/browser.ts
1: import { LocalStoragePreset } from '../presets/browser.js'
3: type Data = {
7: defaultData: Data = { messages: [] }
8: db = LocalStoragePreset<Data>('db', defaultData)

./src/examples/in-memory.ts
 3: import { LowSync, MemorySync, SyncAdapter } from '../index.js'
 4: import { JSONFileSync } from '../node.js'
 8: namespace NodeJS {
15: type Data = Record<string, unknown>
16: defaultData: Data = {}
17: adapter: SyncAdapter<Data> =
22: db = new LowSync<Data>(adapter, defaultData)

./src/examples/server.ts
 4: import express from 'express'
 5: import asyncHandler from 'express-async-handler'
 7: import { JSONFilePreset } from '../presets/node.js'
 9: app = express()
12: type Post = {
17: type Data = {
21: defaultData: Data = { posts: [] }
22: db = await JSONFilePreset<Data>('db.json', defaultData)

./src/adapters/node/DataFile.ts
 1: import { PathLike } from 'fs'
 3: import { Adapter, SyncAdapter } from '../../core/Low.js'
 4: import { TextFile, TextFileSync } from './TextFile.js'
 6: export class DataFile<T> implements Adapter<T> {
      method: read, write
      constructor: constructor
      field: #adapter, #parse, #stringify
40: export class DataFileSync<T> implements SyncAdapter<T> {
      method: read, write
      constructor: constructor
      field: #adapter, #parse, #stringify

./src/core/Low.ts
 1: export interface Adapter<T> {
      field: read, write
 6: export interface SyncAdapter<T> {
      field: read, write
11: function checkArgs(adapter: unknown, defaultData: unknown) {
16: export class Low<T = unknown> {
      method: read, write, update
      constructor: constructor
      field: adapter, data
41: export class LowSync<T = unknown> {
      method: read, write, update
      constructor: constructor
      field: adapter, data

./src/adapters/Memory.ts
 1: import { Adapter, SyncAdapter } from '../core/Low.js'
 3: export class Memory<T> implements Adapter<T> {
      method: read, write
      field: #data
16: export class MemorySync<T> implements SyncAdapter<T> {
      method: read, write
      field: #data

./src/adapters/node/TextFile.test.ts
1: import { deepEqual, equal } from 'node:assert/strict'
2: import test from 'node:test'
4: import { temporaryFile } from 'tempy'
6: import { TextFile, TextFileSync } from './TextFile.js'

./src/adapters/Memory.test.ts
1: import { deepEqual, equal } from 'node:assert/strict'
2: import test from 'node:test'
4: import { Memory, MemorySync } from './Memory.js'

./src/adapters/node/JSONFile.ts
 1: import { PathLike } from 'fs'
 3: import { DataFile, DataFileSync } from './DataFile.js'
 5: export class JSONFile<T> extends DataFile<T> {
      constructor: constructor
14: export class JSONFileSync<T> extends DataFileSync<T> {
      constructor: constructor

./src/adapters/node/TextFile.ts
 1: import { PathLike, readFileSync, renameSync, writeFileSync } from 'node:fs'
 2: import { readFile } from 'node:fs/promises'
 3: import path from 'node:path'
 5: import { Writer } from 'steno'
 7: import { Adapter, SyncAdapter } from '../../core/Low.js'
 9: export class TextFile implements Adapter<string> {
      method: read, write
      constructor: constructor
      field: #filename, #writer
38: export class TextFileSync implements SyncAdapter<string> {
      method: read, write
      constructor: constructor
      field: #tempFilename, #filename

./src/adapters/browser/LocalStorage.ts
1: import { WebStorage } from './WebStorage.js'
3: export class LocalStorage<T> extends WebStorage<T> {
     constructor: constructor

./src/adapters/node/JSONFile.test.ts
1: import { deepEqual, equal } from 'node:assert/strict'
2: import test from 'node:test'
4: import { temporaryFile } from 'tempy'
6: import { JSONFile, JSONFileSync } from './JSONFile.js'
8: type Data = {

./src/adapters/browser/WebStorage.ts
 1: import { SyncAdapter } from '../../core/Low.js'
 3: export class WebStorage<T> implements SyncAdapter<T> {
      method: read, write
      constructor: constructor
      field: #key, #storage

./src/adapters/browser/SessionStorage.ts
1: import { WebStorage } from './WebStorage.js'
3: export class SessionStorage<T> extends WebStorage<T> {
     constructor: constructor

./src/adapters/browser/WebStorage.test.ts
1: import { deepEqual, equal } from 'node:assert/strict'
2: import test from 'node:test'
4: import { WebStorage } from './WebStorage.js'
6: storage: { [key: string]: string } = {}
9: mockStorage = () => ({

</repository_structure_index>
