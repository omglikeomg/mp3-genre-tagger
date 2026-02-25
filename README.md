# MP3 Genre Classifier

A workflow toolkit for classifying and tagging an MP3 music library with genres using an AI agent and a curated genre taxonomy.

## What it does

The project provides a set of Node.js scripts and a structured prompt to guide an AI agent through three phases:

1. **Prepare** — scan your music library and extract metadata into batch JSON files.
2. **Classify** — feed the batches to an AI agent, which assigns primary and secondary genres to every track.
3. **Apply** — write the resulting genre classifications back to the MP3 files as ID3 tags.

## Getting started

See **[index.wiki](./index.wiki)** for the full step-by-step workflow guide, prerequisites, directory structure, script usage, and troubleshooting tips.

## Quick install

```sh
yarn add music-metadata node-id3
```
