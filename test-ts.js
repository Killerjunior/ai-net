const ts = require('typescript');
const fs = require('fs');
const configPath = ts.findConfigFile('./backend', ts.sys.fileExists, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, './backend');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitResult = program.emit();
const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
allDiagnostics.forEach(diagnostic => {
  if (diagnostic.file) {
    let { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
    let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
  } else {
    console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
});
