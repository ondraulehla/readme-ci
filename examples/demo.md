# Demo quickstart

This file is what `readme-ci` sees in a typical README. Run it with:
`readme-ci examples/demo.md`. State carries over between blocks, exactly
like a reader following the steps.

Create a tiny project:

```bash
mkdir hello-app && cd hello-app
echo '{ "name": "hello-app", "version": "1.0.0" }' > package.json
export APP_NAME=hello-app
```

The next block still sits inside `hello-app` and sees the variable:

```bash
test -f package.json
echo "building $APP_NAME"
```

Interpreted languages work too:

```js
const pkg = { name: 'hello-app' };
console.log(`hello from ${pkg.name}`);
```

```python
print("2 + 2 =", 2 + 2)
```

`console` blocks execute only the `$ ` lines – the output lines are prose:

```console
$ echo it works
it works
```

Blocks you never want to run are skipped with a comment:

<!-- readme-ci skip -->
```bash
curl -fsSL https://example.com/install.sh | sh
```

And non-executable fences (json, yaml, plain text) are ignored automatically:

```json
{ "just": "an example" }
```
