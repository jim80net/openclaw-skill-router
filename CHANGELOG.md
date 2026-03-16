# Changelog

## [0.6.0](https://github.com/jim80net/memex-openclaw/compare/v0.5.0...v0.6.0) (2026-03-16)


### Features

* default to local ONNX embeddings (zero API cost) ([55686cb](https://github.com/jim80net/memex-openclaw/commit/55686cb969b5796ddee12df3f1b05d63de15433f))
* embedding client and cosine similarity ([d0317de](https://github.com/jim80net/memex-openclaw/commit/d0317de08b6f5b026939385f6e77bd4e028c7c3d))
* initial plugin structure and manifest ([e5c7b61](https://github.com/jim80net/memex-openclaw/commit/e5c7b61f77b04e0f1e5f5de13762402a72620817))
* memory backend + stop-rule type parity ([0c6d517](https://github.com/jim80net/memex-openclaw/commit/0c6d517a951d3d77c029be50862146be8917d859))
* memory backend + stop-rule type parity with claude-skill-router ([824db94](https://github.com/jim80net/memex-openclaw/commit/824db946c7f772374bb568351dc694e90d09c395))
* multi-query embeddings, incremental mtime rebuilds, heartbeat skip ([a98b6da](https://github.com/jim80net/memex-openclaw/commit/a98b6daf863455701139955c3c5183db95c8f41b))
* Phase 1 — feature parity with claude-skill-router ([13f2ebc](https://github.com/jim80net/memex-openclaw/commit/13f2ebc8ca18e38ffd10bb726d8eed3d43187130))
* plugin entry point and service registration ([7f6ed2d](https://github.com/jim80net/memex-openclaw/commit/7f6ed2dcf52be6cefa37bdf231f515b8298a0602))
* relative scoring mode — inject top-K when best score clears floor ([cd05aee](https://github.com/jim80net/memex-openclaw/commit/cd05aeee16e8edf26b0309e8fa9d815bb52c6653))
* skill index with SKILL.md scanning and vector search ([d77f638](https://github.com/jim80net/memex-openclaw/commit/d77f638e6baa3c1706b846b4302435e165d2da87))
* skill router hook handler ([70ede4d](https://github.com/jim80net/memex-openclaw/commit/70ede4d0689e0c81db5c658bc3cc2450ced21538))
* v0.3.0 — prompt extraction, persistent cache, telemetry, before_tool_call, agent_end hooks ([5df58d7](https://github.com/jim80net/memex-openclaw/commit/5df58d77a0e4f3da2ed4607f3e33d9a4ea1ba6bc))


### Bug Fixes

* add show_full_output + settings permissions to claude-code-review ([cd1028e](https://github.com/jim80net/memex-openclaw/commit/cd1028e0d72e0819efc8fa7c6599893092e087cc))
* align config defaults, deduplicate types, and address review findings ([aa1aad4](https://github.com/jim80net/memex-openclaw/commit/aa1aad4345e5ab9a2eaae9fc391a235ae19236fb))
* align config defaults, deduplicate types, and address review findings ([c8f4ec6](https://github.com/jim80net/memex-openclaw/commit/c8f4ec641273f6971dc9e7c7d5f3611f3f2d19c4))
* deduplicate hook types, clean up imports ([1b90c16](https://github.com/jim80net/memex-openclaw/commit/1b90c162a4573b8ea1cad5d48abe2519455f9807))
* deduplicate hook types, clean up imports ([66ff59a](https://github.com/jim80net/memex-openclaw/commit/66ff59a4255ba85af642c4066167e43447433feb))
* pull version from plugin manifest instead of magic string ([1a4e588](https://github.com/jim80net/memex-openclaw/commit/1a4e588fe3f466d242b142f71aa1828a71ca8258))
* remove hardcoded personal path from generate-queries script ([7524136](https://github.com/jim80net/memex-openclaw/commit/7524136c430897f00ba1b924260fbc225312fe16))
* remove hardcoded personal path from generate-queries script ([57670d7](https://github.com/jim80net/memex-openclaw/commit/57670d78874302dab78c7de62c0f5aef0acdb418))
* resolve @huggingface/transformers from plugin dir, not gateway CWD ([2a37a61](https://github.com/jim80net/memex-openclaw/commit/2a37a61d060b90fb9580b406d298666ea03b76d1))
* upgrade vitest 3.0.0 → 4.1.0 (GHSA-9crc-q9x8-hgqq) and regenerate lockfile ([6236e16](https://github.com/jim80net/memex-openclaw/commit/6236e16a8ffe1d7417c3d91846a6f7b4051fa84a))
