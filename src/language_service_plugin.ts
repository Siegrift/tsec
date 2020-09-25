import * as ts_module from "typescript/lib/tsserverlibrary";
import {Checker} from './third_party/tsetse/checker';
import { ENABLED_RULES } from './rule_groups';
import { DiagnosticWithFix } from './third_party/tsetse/failure';

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

    function create(info: ts.server.PluginCreateInfo) {
        info.project.projectService.logger.info("tslint-language-service loaded");

        // Set up decorator
        const proxy = Object.create(null) as ts.LanguageService;
        const oldLS = info.languageService;
        for (const k in oldLS) {
            (<any>proxy)[k] = function () {
                return (<any>oldLS)[k].apply(oldLS, arguments);
            }
        }

        const tsecFixToCodeFix = (fileName: string, d: DiagnosticWithFix): ts.CodeAction => {
          return {
            description: `Tsec fix`,
            changes: [{
              fileName: fileName,
              textChanges: [{span: {length: d.length!, start: d.start!}, newText: 'tsec replacement'}],
            }]
          };
        }

        proxy.getSemanticDiagnostics = (fileName: string) => {
            const prior = oldLS.getSemanticDiagnostics(fileName);

            const checker = new Checker(oldLS.getProgram()!)

            for (const Rule of ENABLED_RULES) {
              new Rule().register(checker);
            }
    
            prior.push(
              ...checker
                .execute(oldLS.getProgram()!.getSourceFile(fileName)!)
                .map((failure) => {
                  return failure.toDiagnosticWithStringifiedFix()
                }),
            )
            return prior
        };

        proxy.getCodeFixesAtPosition = function (fileName: string, start: number, end: number, errorCodes: number[], formatOptions: ts.FormatCodeSettings, userPreferences: ts.UserPreferences): ReadonlyArray<ts.CodeFixAction> {
            let prior = oldLS.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, userPreferences);
            const fixes = [...prior]

            const checker = new Checker(oldLS.getProgram()!)

            for (const Rule of ENABLED_RULES) {
              new Rule().register(checker);
            }
            
            checker
              .execute(oldLS.getProgram()!.getSourceFile(fileName)!)
              .forEach((failure) => {
                const d = failure.toDiagnostic();
                console.log('aaaaa', fileName, start, end)
                if (d.fix) fixes.push(tsecFixToCodeFix(fileName, d) as ts.CodeFixAction);
              })

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
