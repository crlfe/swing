# Swing

Swing, as in "take a swing at it", is a silly experimental editor that I'm using to play with both
vibe coding and the protocols underlying modern LLMs. My goal is to push the limits of small models
to gain a better intuition of how they succeed and how they fail. So this codebase is _very_ sloppy,
mostly from having Gemma 4 12B (local) or 31B (Ollama cloud) handle small feature requests or bug
reports, with no specific instructions and very little tooling. I am now hitting the limits of these
models, so this seemed a good point to share the results of a couple of afternoons fiddling.

Next up is a vite dev plugin to let the editor read and write its own code, guided refactoring to
simplify UI updates (which has been a source of many bugs), and introducing better tooling than bulk
read_file and write_file.

## Usage

The hilariously experimental Swing editor is available at
[crlfe.github.io/swing](http://crlfe.github.io/swing/). Take a look, poke around, and be awed by
just how... slightly off... the user interface feels. Most of it mostly works, most of the time.

To use an LLM with it, you will need to provide an OpenAI-compatible endpoint. I have regularly used
an Ollama server running on localhost and llama-server running on another local computer.

### Local Ollama Server

Grab a copy of Ollama from [ollama.com/download](https://ollama.com/download). To avoid root on
Linux, I used the manual download instructions and extracted into my `~/opt`.

Run `OLLAMA_ORIGINS=https://crlfe.github.io ollama serve` to start the local server. The
`OLLAMA_ORIGINS` environment variable being set to `https://crlfe.github.io` lets the Swing webapp
running in your browser from GitHub access your local Ollama server.

Next, run either `ollama signin` to get access to their cloud models, or `ollama pull` to download a
local model. See [Ollama's documentation](https://docs.ollama.com/cloud) for more information.

Start Swing's chat with URL `http://localhost:11434/v1/chat/completions`, your choice of model, and
a blank API key.

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)

### Prepare Source and Dependencies

```bash
git clone https://github.com/crlfe/swing.git
cd swing
pnpm install
```

### Development

To start the Vite server in development mode with hot-reloading:

```bash
pnpm run dev
```

Then point your browser to [http://localhost:5173](http://localhost:5173)

### Production Build

To build the project as a static website:

```bash
pnpm run build
```

The output will be generated in the `dist/` directory.

# License and Warranty Disclaimer

```
MIT License

Copyright (c) 2026 Chris Wolfe <https://crlfe.ca/>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
