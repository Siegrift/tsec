import * as ts from 'typescript'

import { Checker } from '../../checker'
import { ErrorCode } from '../../error_code'
import { debugLog } from '../ast_tools'
import { Fixer } from '../fixer'
import { PropertyMatcher } from '../property_matcher'

import { matchProperty, PropertyEngine } from './property_engine'

/** Test if an AST node is a matched property write. */
export function matchPropertyWrite(
  tc: ts.TypeChecker,
  n: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  matcher: PropertyMatcher,
): ts.BinaryExpression | undefined {
  debugLog(() => `eee irightnspecting ${n.parent.getText().trim()}`)

  if (matchProperty(tc, n, matcher) === undefined) return

  const assignment = n.parent

  if (!ts.isBinaryExpression(assignment)) return
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
  if (assignment.left !== n) return

  return assignment
}

const isAsExpOfAllowedType = (
  tc: ts.TypeChecker,
  n: ts.Expression,
  allowed: string[],
) => {
  debugLog(() => `calling isAsExpOfAllowedType WTF ${allowed}`)
  if (!ts.isAsExpression(n)) return false
  if (
    !ts.isAsExpression(n.expression) ||
    n.type.kind !== ts.SyntaxKind.StringKeyword
  )
    return false

  const innerExp = n.expression
  const type = tc.getTypeAtLocation(innerExp.expression).getSymbol()?.name
  const s = tc.getTypeAtLocation(innerExp.expression).getSymbol()
  const fnq = tc.getFullyQualifiedName(s!)
  const p = s?.getDeclarations()
  return (
    type &&
    allowed.includes(type) &&
    innerExp.type.kind === ts.SyntaxKind.UnknownKeyword
  )
}

/**
 * The engine for BANNED_PROPERTY_WRITE.
 */
export class PropertyWriteEngine extends PropertyEngine {
  matchPropertyWriteClassy = (
    tc: ts.TypeChecker,
    n: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    matcher: PropertyMatcher,
  ): ts.BinaryExpression | undefined => {
    debugLog(() => `eee inspecting ${n.parent.getText().trim()}`)

    if (matchProperty(tc, n, matcher) === undefined) return

    const assignment = n.parent

    if (!ts.isBinaryExpression(assignment)) return
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
    if (assignment.left !== n) return

    // TODO: match type
    const r = assignment.right
    const typeName = tc.getTypeAtLocation(r).getSymbol()?.name

    debugLog(() => `${r.getText()} ${typeName} ${this.config.allowedTypes}`)
    if (!this.config.allowedTypes) return assignment
    // or provide fix
    else if (typeName && this.config.allowedTypes?.includes(typeName)) return
    else if (isAsExpOfAllowedType(tc, r, this.config.allowedTypes || [])) return
    else return assignment
  }

  register(checker: Checker) {
    this.registerWith(checker, this.matchPropertyWriteClassy)
  }
}
