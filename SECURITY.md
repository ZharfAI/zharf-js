# Security Policy

## Reporting a vulnerability

Please do not report security problems in a public issue, pull request or discussion.

Email **security@zharf.ai** instead, with:

- what the problem is and what an attacker could do with it;
- the version of `zharf` and the runtime (Node, Deno, Bun or the browser, and its version);
- steps or code that show it.

We will reply to confirm we have your report and keep you told of progress. If you wish, we will credit you when the fix is released. Please give us a reasonable time to fix the problem before you make it public.

## Supported versions

Fixes go into the latest release. Upgrade to it to get them.

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Scope

This policy covers the code in this repository: the `zharf` npm package and its examples. Problems in the platform itself (platform.zharf.ai) go to the same address.

## If a key leaks

If a `zk-…` key has been exposed, for example committed to a repository or shipped in a web page, revoke it at once on the [keys page](https://platform.zharf.ai/keys) and create a new one. A key in a web page can be read by anyone who opens the page; see "Browser Usage" in the [README](README.md).
