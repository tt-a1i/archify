import fs from 'node:fs';
import { DiagnosticError, fail } from '../core/index.mjs';

export const driftReportMaxBytes = 32 * 1024 * 1024;

export function readDriftInput(inputPath, name, maxBytes = 4 * 1024 * 1024) {
  let fd;
  const invalid = () => fail('drift/input-invalid', `Select a readable JSON file no larger than ${maxBytes / 1024 / 1024} MiB.`, { subject: { input: name } });
  try {
    if (!fs.statSync(inputPath).isFile()) invalid();
    fd = fs.openSync(inputPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) invalid();
    const buffer = Buffer.alloc(stat.size + 1);
    if (fs.readSync(fd, buffer, 0, buffer.length) !== stat.size) invalid();
    const bytes = buffer.subarray(0, stat.size);
    return { bytes, doc: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    invalid();
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
