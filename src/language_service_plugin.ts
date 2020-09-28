import * as ts_module from "typescript/lib/tsserverlibrary";
import {Checker} from './third_party/tsetse/checker';
import { ENABLED_RULES } from './rule_groups';
import { DiagnosticWithFix, Failure } from './third_party/tsetse/failure';

const TSETSE_ERROR_CODE = 21228;

function init(modules: { typescript: typeof ts_module }) {
    const ts = modules.typescript;

    let registeredCodeFixes = false;

    // Work around the lack of API to register a CodeFix
    function registerCodeFix(action: codefix.CodeFix) {
        return (ts as any).codefix.registerCodeFix(action);
    }

    if (!registeredCodeFixes && ts && (ts as any).codefix) {
        registerCodeFixes(registerCodeFix);
        registeredCodeFixes = true;
    }

    function registerCodeFixes(registerCodeFix: (action: codefix.CodeFix) => void) {
        // Code fix for that is used for all tslint fixes
        registerCodeFix({
            errorCodes: [TSETSE_ERROR_CODE],
            getCodeActions: (_context: any) => {
                return undefined;
            }
        });
    }

    function createProxy<T>(delegate: T): T {
      const proxy = Object.create(null);
      for (const k of Object.keys(delegate)) {
        proxy[k] = function() {
          return (delegate as any)[k].apply(delegate, arguments);
        };
      }
      return proxy;
    }

    const diagnosticToCodeFixAction = (d: DiagnosticWithFix): ts.CodeFixAction|undefined => {
      if (!d.fix) return undefined;

      return {
        fixName: 'Fix name lala', // for TS telemetry use
        description: `Tsec fix`, // display name of the code action shown in the IDE
        changes: d.fix!.changes.map(c => ({
          fileName: c.sourceFile.fileName,
          textChanges: [{span: {start: c.start, length: c.end - c.start}, newText: c.replacement + 'aaa'}]
        }))
      }
    }

    const codeFixActions = new Map<string, Map<string, ts.CodeFixAction[]>>();

    function create(info: ts.server.PluginCreateInfo) {
        info.project.projectService.logger.info("tslint-language-service loaded");

        const oldLS = info.languageService
        // Set up decorator
        const proxy = createProxy(info.languageService)

        function computeKey(start: number | undefined, end: number): string {
          return `[${start},${end}]`
        }

        proxy.getSemanticDiagnostics = (fileName: string) => {
            const result = oldLS.getSemanticDiagnostics(fileName);

            const checker = new Checker(oldLS.getProgram()!)

            for (const Rule of ENABLED_RULES) {
              new Rule().register(checker);
            }

            const failures = checker
              .execute(oldLS.getProgram()!.getSourceFile(fileName)!)


            codeFixActions.set(fileName, new Map())
            const codeActionsForCurrentFile = codeFixActions.get(fileName)!;
            failures.forEach(failure => {
              const d = failure.toDiagnostic()
              const codeAction = diagnosticToCodeFixAction(d)
              if (codeAction) {
                const key = computeKey(d.start, d.end)
                if (!codeActionsForCurrentFile.has(key)) codeActionsForCurrentFile.set(key, [])
                codeActionsForCurrentFile.get(key)!.push(codeAction)
              }
            })
    
            result.push(
              ...failures
                .map((failure) => {
                  return failure.toDiagnosticWithStringifiedFix()
                }),
            )
            return result
        };

        proxy.getCodeFixesAtPosition = function (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> {
            let prior = oldLS.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, userPreferences);
            const fixes = [...prior]

            // const checker = new Checker(oldLS.getProgram()!)

            // for (const Rule of ENABLED_RULES) {
            //   new Rule().register(checker);
            // }
            
            // checker
            //   .execute(oldLS.getProgram()!.getSourceFile(fileName)!)
            //   .forEach((failure) => {
            //     const fix = diagnosticToCodeFixAction(failure.toDiagnostic())
            //     if (fix) fixes.push(fix);
            //   })

            const codeActionsForCurrentFile = codeFixActions.get(fileName);
            if (codeActionsForCurrentFile) {
              const actions = codeActionsForCurrentFile.get(computeKey(start, end))
              if(actions) {
                actions.forEach(action => {fixes.push(action);})
              }
            }

            return fixes
        };
        return proxy;
    }

    return { create };
}

export = init;

/* @internal */
// work around for missing API to register a code fix
namespace codefix {

    export interface CodeFix {
        errorCodes: number[];
        getCodeActions(context: any): ts.CodeAction[] | undefined;
    }
}
