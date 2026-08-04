import fs from 'node:fs'
import path from 'node:path'
import PhpParser from 'php-parser'

const parser = new PhpParser({
  parser: {
    extractDoc: true,
    suppressErrors: false,
  },
  ast: {
    withPositions: true,
  },
})

function phpFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return phpFiles(target)
    return entry.isFile() && entry.name.endsWith('.php') ? [target] : []
  })
}

const files = [...phpFiles('server'), ...phpFiles('public')]

for (const file of files) {
  parser.parseCode(fs.readFileSync(file, 'utf8'), file)
}

console.log(`Parsed ${files.length} PHP files successfully.`)
