// Copyright 2020 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Turn on a TS security checker to ban setInverval and setTimeout
 * when they are called to evaluate strings as scripts.
 *
 * Unlike other rules that only look at the property/name, this rule checks if
 * the functions are called with strings as the first argument. Therefore, none
 * of the pattern engines directly applies to this rule. We could have used
 * BANNED_NAME and BANNED_PROPERTY like we did for open and eval, but it causes
 * too many false positives in this case.
 */

import {Checker} from '../third_party/tsetse/checker';
import {ErrorCode} from '../third_party/tsetse/error_code';
import {AbstractRule} from '../third_party/tsetse/rule';
import {AbsoluteMatcher} from '../third_party/tsetse/util/absolute_matcher';
import {Allowlist, AllowlistEntry} from '../third_party/tsetse/util/allowlist';
import {shouldExamineNode} from '../third_party/tsetse/util/ast_tools';
import {PropertyMatcher} from '../third_party/tsetse/util/property_matcher';

import * as path from 'path';
import * as ts from 'typescript';

const BANNED_NAMES = [
  'GLOBAL|setInterval',
  'GLOBAL|setTimeout',
];

const BANNED_PROPERTIES = [
  'Window.prototype.setInterval',
  'Window.prototype.setTimeout',
];

function errMsg(bannedEntity: string): string {
  let errMsg = `Do not use ${
      bannedEntity}, as calling it with a string argument can cause code-injection security vulnerabilities.`;
  return errMsg;
}

/**
 * Checks if the APIs are called with staticly defined functions that
 * won't trigger an eval-like effect. This pattern is safe to use, so
 * we want to exclude it from the reported errors.
 */
function isCalledWithNonStrArg(n: ts.Node, tc: ts.TypeChecker) {
  if (!ts.isCallExpression(n.parent) || n.parent.expression !== n) return false;
  // Having zero arguments will trigger other compiler errors. We should not
  // bother emitting a Tsetse error.
  if (n.parent.arguments.length === 0) return true;

  const firstArgType = tc.getTypeAtLocation(n.parent.arguments[0]);

  return (firstArgType.flags &
          (ts.TypeFlags.String | ts.TypeFlags.StringLike |
           ts.TypeFlags.StringLiteral)) === 0;
}

/**
 * A type selector that resolves to AbsoluteMatcher or PropertyMatcher based on
 * the type of AST node to be matched.
 */
type NodeMatcher<T extends ts.Node> = T extends ts.Identifier ?
    AbsoluteMatcher :
    T extends ts.PropertyAccessExpression ?
    PropertyMatcher :
    {matches: (n: ts.Node, tc: ts.TypeChecker) => never};

function checkNode<T extends ts.Node>(
    tc: ts.TypeChecker, n: T, matcher: NodeMatcher<T>): ts.Node|undefined {
  if (!shouldExamineNode(n)) return;
  if (!matcher.matches(n, tc)) return;
  if (isCalledWithNonStrArg(n, tc)) return;
  return n;
}

/**
 * A rule that checks the uses of Window#setTimeout and Window#setInterval
 * properties; it also checks the global setTimeout and setInterval functions.
 */
export class Rule extends AbstractRule {
  static readonly RULE_NAME = 'ban-window-stringfunctiondef';
  readonly ruleName = Rule.RULE_NAME;
  readonly code = ErrorCode.CONFORMANCE_PATTERN;

  private readonly nameMatchers: readonly AbsoluteMatcher[];
  private readonly propMatchers: readonly PropertyMatcher[];

  private readonly allowlist?: Allowlist;

  constructor(allowlistEntries?: AllowlistEntry[]) {
    super();
    this.nameMatchers = BANNED_NAMES.map(name => new AbsoluteMatcher(name));
    this.propMatchers = BANNED_PROPERTIES.map(PropertyMatcher.fromSpec);
    if (allowlistEntries) {
      this.allowlist = new Allowlist(allowlistEntries);
    }
  }

  register(checker: Checker) {
    // Check global names
    for (const nameMatcher of this.nameMatchers) {
      checker.onNamedIdentifier(
          nameMatcher.bannedName,
          (c, n) => {
            // window.id is automatically resolved to id, so the matcher will be
            // able to match it. But we don't want redundant errors. Skip the
            // node if it is part of a property access expression.
            if (ts.isPropertyAccessExpression(n.parent)) return;
            if (ts.isQualifiedName(n.parent)) return;

            const node = checkNode(c.typeChecker, n, nameMatcher);
            if (node) {
              if (this.allowlist?.isAllowlisted(
                      path.resolve(node.getSourceFile().fileName))) {
                return;
              }
              checker.addFailureAtNode(node, errMsg(nameMatcher.bannedName));
            }
          },
          this.code,
      );
    }
    // Check properties
    for (const propMatcher of this.propMatchers) {
      checker.onNamedPropertyAccess(
          propMatcher.bannedProperty,
          (c, n) => {
            const node = checkNode(c.typeChecker, n, propMatcher);
            if (node) {
              if (this.allowlist?.isAllowlisted(
                      path.resolve(node.getSourceFile().fileName))) {
                return;
              }
              checker.addFailureAtNode(
                  node,
                  errMsg(`${propMatcher.bannedType}#${
                      propMatcher.bannedProperty}`));
            }
          },
          this.code,
      );
    }
  }
}
