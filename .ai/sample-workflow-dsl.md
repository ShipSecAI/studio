# Sample Workflow (Trigger → Subfinder → Save File)

## Visual DAG
```
Trigger (manual input)
   ↓
Subfinder module
   ↓
Save JSON artifact
```

## ShipSec DSL
```yaml
title: "Enumerate subdomains"
description: "Run Subfinder and store results"
entrypoint:
  ref: "trigger_manual"
  expects:
    domain:
      type: string
      required: true
actions:
  - ref: trigger_manual
    action: core.trigger.manual
    args: {}
    depends_on: []

  - ref: subfinder
    action: projectdiscovery.subfinder.run
    args:
      domain: "{{ actions.trigger_manual.result.domain }}"
      threads: 10
    depends_on:
      - trigger_manual

  - ref: save_file
    action: core.artifact.write_json
    args:
      data: "{{ actions.subfinder.result.subdomains }}"
      filename: "subdomains.json"
    depends_on:
      - subfinder
config:
  environment: default
  timeout: 0
```

## Temporal Execution Flow
1. Workflow code topologically sorts actions.
2. For each node: render templated args, call `workflow.executeActivity` with mapped module name.
3. `runSubfinder` activity runs CLI, returns `{ subdomains: [...] }`.
4. `writeJsonArtifact` activity uploads artifact, returns URI/path.
5. Results stored in map keyed by `ref`; final node output returned to caller.
