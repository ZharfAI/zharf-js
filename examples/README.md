# Examples

Build the library once, then run any example with Node (18 or later). Inside this repository
`import zharf from 'zharf'` resolves to the build in `dist/`; in your own project it is the
installed package.

```sh
npm install
npm run build
export ZHARF_API_KEY="zk-..."   # not needed for list.mjs

node examples/list.mjs          # models and prices; no key needed
node examples/chat.mjs          # one question, one answer, and its cost
node examples/stream.mjs        # the answer as it is written
node examples/abort.mjs         # stop a stream part-way
node examples/tools.mjs         # let the model call a function
node examples/embed.mjs         # embed sentences and compare them
node examples/browser/server.mjs   # then open http://localhost:3000
```

The browser example keeps the key on a small Node server and points the page's client at a route
there (`host: '/api/zharf'`). Do the same in your own app: an API key in a web page can be read by
anyone who opens it.
