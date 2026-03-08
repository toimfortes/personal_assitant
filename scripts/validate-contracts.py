#!/usr/bin/env python3
"""Validate repository governance contracts.

This script enforces:
1) JSON schema compliance for memory and function contracts.
2) JSON schema compliance for n8n workflows and MCP config.
3) Cross-file consistency between matter index and matter files.
4) Cross-file consistency between function registry refs and real files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parent.parent


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def format_error_path(error) -> str:
    if not error.absolute_path:
        return "$"
    return "$." + ".".join(str(p) for p in error.absolute_path)


def validate_schema(instance_path: Path, schema_path: Path, errors: list[str]) -> Any | None:
    if not instance_path.exists():
        errors.append(f"{rel(instance_path)} missing.")
        return None
    instance = read_json(instance_path)
    schema = read_json(schema_path)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    schema_errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    for err in schema_errors:
        errors.append(
            f"{rel(instance_path)} violates {rel(schema_path)} at {format_error_path(err)}: {err.message}"
        )
    return instance


def validate_workflow_graph(workflow_path: Path, workflow: dict[str, Any], errors: list[str]) -> None:
    nodes = workflow.get("nodes", [])
    connections = workflow.get("connections", {})
    node_names = {node.get("name") for node in nodes if isinstance(node, dict) and node.get("name")}

    if len(node_names) != len(nodes):
        errors.append(f"{rel(workflow_path)} has duplicate or empty node names.")

    for source_name, mapping in connections.items():
        if source_name not in node_names:
            errors.append(f"{rel(workflow_path)} has connection source '{source_name}' with no matching node.")
        if not isinstance(mapping, dict):
            continue
        for edge_group in mapping.values():
            if not isinstance(edge_group, list):
                continue
            for branch in edge_group:
                if not isinstance(branch, list):
                    continue
                for edge in branch:
                    if not isinstance(edge, dict):
                        continue
                    target = edge.get("node")
                    if target and target not in node_names:
                        errors.append(
                            f"{rel(workflow_path)} has edge target '{target}' with no matching node."
                        )


def validate_matter_cross_refs(
    matter_index_path: Path, matter_index: dict[str, Any], matter_schema_path: Path, errors: list[str]
) -> None:
    seen_ids: set[str] = set()
    for entry in matter_index.get("matters", []):
        matter_id = entry["matter_id"]
        if matter_id in seen_ids:
            errors.append(f"{rel(matter_index_path)} has duplicate matter_id '{matter_id}'.")
        seen_ids.add(matter_id)

        matter_file = ROOT / entry["file"]
        matter = validate_schema(matter_file, matter_schema_path, errors)
        if not isinstance(matter, dict):
            continue

        if matter.get("matter_id") != matter_id:
            errors.append(
                f"{rel(matter_file)} matter_id '{matter.get('matter_id')}' does not match index '{matter_id}'."
            )
        if matter.get("status") != entry.get("status"):
            errors.append(
                f"{rel(matter_file)} status '{matter.get('status')}' does not match index '{entry.get('status')}'."
            )
        if matter.get("priority") != entry.get("priority"):
            errors.append(
                f"{rel(matter_file)} priority '{matter.get('priority')}' does not match index '{entry.get('priority')}'."
            )
        if matter.get("owner") != entry.get("owner"):
            errors.append(
                f"{rel(matter_file)} owner '{matter.get('owner')}' does not match index '{entry.get('owner')}'."
            )


def validate_function_registry_refs(
    registry_path: Path, registry: dict[str, Any], hook_schema_path: Path, errors: list[str]
) -> None:
    ids: set[str] = set()
    for function in registry.get("functions", []):
        fn_id = function["function_id"]
        if fn_id in ids:
            errors.append(f"{rel(registry_path)} has duplicate function_id '{fn_id}'.")
        ids.add(fn_id)

        ref = function["implemented_by"]["ref"].split("#", 1)[0]
        ref_path = ROOT / ref
        if ref and not ref_path.exists():
            errors.append(f"{rel(registry_path)} function '{fn_id}' references missing path '{ref}'.")

        impl_type = function["implemented_by"]["type"]
        if impl_type == "openclaw-hook" and ref_path.exists():
            validate_schema(ref_path, hook_schema_path, errors)


def validate_mcp_env_hygiene(mcp_path: Path, mcp_config: dict[str, Any], errors: list[str]) -> None:
    sensitive_markers = ("TOKEN", "KEY", "SECRET", "PASSWORD", "DATABASE_URL", "CONNECTION_STRING")
    servers = mcp_config.get("mcpServers", {})
    if not isinstance(servers, dict):
        return

    for server_name, server in servers.items():
        if not isinstance(server, dict):
            continue
        env = server.get("env", {})
        if not isinstance(env, dict):
            continue

        for env_key, env_value in env.items():
            if not isinstance(env_value, str):
                continue
            key_upper = env_key.upper()
            if any(marker in key_upper for marker in sensitive_markers):
                if not env_value.startswith("$"):
                    errors.append(
                        f"{rel(mcp_path)} mcpServers.{server_name}.env.{env_key} must reference an env var "
                        f"(value should start with '$'), not a literal secret."
                    )

        memory_file_path = env.get("MEMORY_FILE_PATH")
        if isinstance(memory_file_path, str) and memory_file_path:
            if not memory_file_path.startswith("/home/node/.openclaw/workspace/"):
                errors.append(
                    f"{rel(mcp_path)} mcpServers.{server_name}.env.MEMORY_FILE_PATH must stay under "
                    "/home/node/.openclaw/workspace/."
                )


def main() -> int:
    errors: list[str] = []

    schema_dir = ROOT / "contracts" / "schemas"
    matter_schema = schema_dir / "matter.schema.json"
    matter_index_schema = schema_dir / "matter-index.schema.json"
    function_registry_schema = schema_dir / "function-registry.schema.json"
    hook_schema = schema_dir / "openclaw-hook-agent.schema.json"
    mcp_schema = schema_dir / "openclaw-mcp-config.schema.json"
    n8n_schema = schema_dir / "n8n-workflow.schema.json"

    matter_index = validate_schema(ROOT / "memory" / "matter-index.json", matter_index_schema, errors)
    if isinstance(matter_index, dict):
        validate_matter_cross_refs(ROOT / "memory" / "matter-index.json", matter_index, matter_schema, errors)

    function_registry = validate_schema(
        ROOT / "contracts" / "function-registry.json",
        function_registry_schema,
        errors,
    )
    if isinstance(function_registry, dict):
        validate_function_registry_refs(ROOT / "contracts" / "function-registry.json", function_registry, hook_schema, errors)

    mcp_config = validate_schema(ROOT / "openclaw-configs" / "mcp-config.json", mcp_schema, errors)
    if isinstance(mcp_config, dict):
        validate_mcp_env_hygiene(ROOT / "openclaw-configs" / "mcp-config.json", mcp_config, errors)

    for wf_path in sorted((ROOT / "n8n-workflows").glob("*.json")):
        workflow = validate_schema(wf_path, n8n_schema, errors)
        if isinstance(workflow, dict):
            validate_workflow_graph(wf_path, workflow, errors)

    if errors:
        print("Contract validation failed:")
        for err in errors:
            print(f"- {err}")
        return 1

    print("Contract validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
