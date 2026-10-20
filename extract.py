#!/usr/bin/env python3
"""Reassemble the gateway middleware's REQCHUNK log lines back into JSON records.

The middleware runs in magpie's moejs sandbox, which has no `fs`, so each
record is emitted as numbered one-line chunks:

    <log prefix> REQCHUNK <seq>/<total> [<index>] <json payload>

Chunks of one call are contiguous; `CAPTURE_REQ <seq> begin|end` lines bound
them. This script slices journald, groups chunks per call and writes a JSON
file per complete record to /root/workspace/magpie-mw/capture/.
"""
import json
import re
import subprocess
import sys

MARK_REQ = re.compile(r"CAPTURE_REQ (\d+) (begin|end) model=(\S+) bytes=(\d+)(?: via=(\S+) file=(\S+))?")
MARK_INIT = re.compile(r"CAPTURE_INIT")
MARK_CHUNK = re.compile(r"REQCHUNK (\d+)/(\d+) \[(\d+)\] ")
MARK_ERR = re.compile(r"CAPTURE_ERR")


def main():
    args = sys.argv[1:]
    log = None
    if "--log" in args:
        i = args.index("--log")
        log = args[i + 1]
        del args[i:i + 2]
    prefix = ""
    if "--prefix" in args:
        i = args.index("--prefix")
        prefix = args[i + 1] + "-"
        del args[i:i + 2]
    since = args[0]
    outdir = args[1] if len(args) > 1 else "/root/workspace/magpie-mw/capture"
    if log:
        with open(log) as fh:
            raw = fh.read()
    else:
        raw = subprocess.run(
            ["journalctl", "-u", "magpie", "--since", since, "-o", "cat", "--no-pager"],
            capture_output=True, text=True, check=True).stdout

    records = []      # completed records
    cur = None
    for line in raw.splitlines():
        m = MARK_CHUNK.search(line)
        if m:
            if cur is None:
                cur = {"chunks": {}, "total": int(m.group(2)), "seq": int(m.group(1)), "begin": None, "end": None}
            cur["chunks"][int(m.group(3))] = line[m.end():]
            continue
        m = MARK_REQ.search(line)
        if m:
            seq, kind = int(m.group(1)), m.group(2)
            if kind == "begin":
                if cur is not None:
                    records.append(cur)
                cur = {"chunks": {}, "total": None, "seq": seq, "begin": line, "end": None, "bytes": int(m.group(4))}
            else:
                if cur is None:
                    cur = {"chunks": {}, "total": None, "seq": seq, "begin": None, "end": None, "bytes": int(m.group(4))}
                cur["end"] = line
                cur["via"] = m.group(5)
                cur["file"] = m.group(6)
                records.append(cur)
                cur = None
            continue
        if cur is not None and MARK_INIT.search(line):
            records.append(cur)
            cur = None
    if cur is not None:
        records.append(cur)

    summary = []
    for i, r in enumerate(records, 1):
        if not r["chunks"]:
            summary.append("record %d seq=%s: no chunks" % (i, r["seq"]))
            continue
        total = r["total"] or max(r["chunks"])
        payload = "".join(r["chunks"].get(k, "") for k in range(1, total + 1))
        complete = bool(r["end"]) and all(k in r["chunks"] for k in range(1, total + 1))
        status = "OK" if complete else "PARTIAL"
        path = "%s/%sreassembled-%02d-seq%02d.json" % (outdir, prefix, i, r["seq"])
        rec = None
        try:
            rec = json.loads(payload)
            with open(path, "w") as fh:
                fh.write(json.dumps(rec, indent=2, ensure_ascii=False))
            note = "json=valid"
        except Exception as exc:  # noqa: BLE001
            with open(path + ".raw", "w") as fh:
                fh.write(payload)
            note = "json=INVALID(%s)" % exc
        summary.append(
            "record %d seq=%s status=%s chunks=%d/%s payload_bytes=%d %s file=%s"
            % (i, r["seq"], status, len(r["chunks"]), total, len(payload), note, path))
    print("\n".join(summary))


if __name__ == "__main__":
    main()
