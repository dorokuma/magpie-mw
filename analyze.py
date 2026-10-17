#!/usr/bin/env python3
"""Structural analysis of the reassembled capture records (no payload text)."""
import json
import sys


def load(path):
    with open(path) as fh:
        return json.load(fh)


def tool_table(d):
    tools = json.loads(d["tools_json"]) if d.get("tools_json") else []
    rows = []
    for t in tools:
        fn = t.get("function") or {}
        params = fn.get("parameters")
        keys = sorted(params.keys()) if isinstance(params, dict) else None
        props = list((params or {}).get("properties", {}).keys()) if isinstance(params, dict) else []
        rows.append({
            "name": fn.get("name"),
            "type": t.get("type"),
            "param_keys": keys,
            "has_required": isinstance(params, dict) and "required" in params,
            "required": (params or {}).get("required") if isinstance(params, dict) else None,
            "properties": props,
        })
    return rows


def main():
    for path in sys.argv[1:]:
        d = load(path)
        print("=" * 78)
        print("FILE", path)
        print("captured_at", d.get("captured_at"), "model", d.get("model"), "stream", d.get("stream"),
              "raw_bytes", d.get("raw_bytes"), "via", d.get("via"), "bytes", d.get("bytes"))
        print("top_level_keys", d.get("top_level_keys"))
        print("tools_count", d.get("tools_count"))
        for r in tool_table(d):
            print("  TOOL %-28s required=%-5s param_keys=%s properties=%s"
                  % (r["name"], r["has_required"], r["param_keys"], r["properties"])
                  + (" required_value=%s" % r["required"] if r["has_required"] else ""))
        print("scalar_fields:")
        for k, v in (d.get("scalar_fields") or {}).items():
            print("   %-24s %s" % (k, "null" if v is None else v.get("head")))
        print("other_top_level:", json.dumps(d.get("other_top_level"), ensure_ascii=False))
        print("ctx.enumerable_keys", d["ctx"]["enumerable_keys"])
        for k in [k for k in d["ctx"]["values"] if not k.startswith("__")]:
            val = d["ctx"]["values"][k]
            print("   ctx.%s = %s" % (k, json.dumps(val, ensure_ascii=False)[:160]))
        print("messages (%s):" % d.get("messages_count"))
        for i, m in enumerate(d.get("messages") or []):
            print("  [%d] role=%s keys=%s content_type=%s blocks=%s content_len=%s has_tool_calls=%s has_tool_call_id=%s"
                  % (i, m["role"], m["keys"], m["content_type"], m["content_block_types"], m["content_len"],
                     m["has_tool_calls"], m["has_tool_call_id"]))
            if m["reasoning_fields"]:
                for fk, fv in m["reasoning_fields"].items():
                    print("      reason_field %s len=%s head=%r" % (fk, fv["len"], fv["head"][:80]))
            if m["tool_calls"]:
                for tc in m["tool_calls"]:
                    print("      tool_call id=%s name=%s args_len=%s args_head=%r"
                          % (tc["id"]["head"] if tc["id"] else None, tc["function_name"],
                             tc["arguments_len"], (tc["arguments_head"]["head"] or "")[:80]))
            if m["tool_call_id"]:
                print("      tool_call_id=%s" % m["tool_call_id"]["head"])
            print("      content_head=%r" % ((m["content_head"]["head"] or "")[:120]))


if __name__ == "__main__":
    main()
