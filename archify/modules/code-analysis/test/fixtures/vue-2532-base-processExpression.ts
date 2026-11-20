export function processExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  // some expressions like v-slot props & v-for aliases should be parsed as
  // function params
  asParams = false,
  // v-on handler values may contain multiple statements
  asRawStatements = false
): ExpressionNode {
  if (__DEV__ && __BROWSER__) {
    // simple in-browser validation (same logic in 2.x)
    validateBrowserExpression(node, context, asParams, asRawStatements)
    return node
  }

  if (!context.prefixIdentifiers || !node.content.trim()) {
    return node
  }

  const { bindingMetadata } = context
  const prefix = (raw: string) => {
    const source = hasOwn(bindingMetadata, raw)
      ? `$` + bindingMetadata[raw]
      : `_ctx`
    return `${source}.${raw}`
  }

  // fast path if expression is a simple identifier.
  const rawExp = node.content
  // bail on parens to prevent any possible function invocations.
  const bailConstant = rawExp.indexOf(`(`) > -1
  if (isSimpleIdentifier(rawExp)) {
    if (
      !asParams &&
      !context.identifiers[rawExp] &&
      !isGloballyWhitelisted(rawExp) &&
      !isLiteralWhitelisted(rawExp)
    ) {
      node.content = prefix(rawExp)
    } else if (!context.identifiers[rawExp] && !bailConstant) {
      // mark node constant for hoisting unless it's referring a scope variable
      node.isConstant = true
    }
    return node
  }

  let ast: any
  // exp needs to be parsed differently:
  // 1. Multiple inline statements (v-on, with presence of `;`): parse as raw
  //    exp, but make sure to pad with spaces for consistent ranges
  // 2. Expressions: wrap with parens (for e.g. object expressions)
  // 3. Function arguments (v-for, v-slot): place in a function argument position
  const source = asRawStatements
    ? ` ${rawExp} `
    : `(${rawExp})${asParams ? `=>{}` : ``}`
  try {
    ast = parse(source, {
      plugins: [...context.expressionPlugins, ...babelParserDefaultPlugins]
    }).program
  } catch (e) {
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        e.message
      )
    )
    return node
  }

  const ids: (Identifier & PrefixMeta)[] = []
  const knownIds = Object.create(context.identifiers)
  const isDuplicate = (node: Node & PrefixMeta): boolean =>
    ids.some(id => id.start === node.start)

  // walk the AST and look for identifiers that need to be prefixed.
  ;(walk as any)(ast, {
    enter(node: Node & PrefixMeta, parent: Node) {
      if (node.type === 'Identifier') {
        if (!isDuplicate(node)) {
          const needPrefix = shouldPrefix(node, parent)
          if (!knownIds[node.name] && needPrefix) {
            if (isPropertyShorthand(node, parent)) {
              // property shorthand like { foo }, we need to add the key since we
              // rewrite the value
              node.prefix = `${node.name}: `
            }
            node.name = prefix(node.name)
            ids.push(node)
          } else if (!isStaticPropertyKey(node, parent)) {
            // The identifier is considered constant unless it's pointing to a
            // scope variable (a v-for alias, or a v-slot prop)
            if (!(needPrefix && knownIds[node.name]) && !bailConstant) {
              node.isConstant = true
            }
            // also generate sub-expressions for other identifiers for better
            // source map support. (except for property keys which are static)
            ids.push(node)
          }
        }
      } else if (isFunction(node)) {
        // walk function expressions and add its arguments to known identifiers
        // so that we don't prefix them
        node.params.forEach(p =>
          (walk as any)(p, {
            enter(child: Node, parent: Node) {
              if (
                child.type === 'Identifier' &&
                // do not record as scope variable if is a destructured key
                !isStaticPropertyKey(child, parent) &&
                // do not record if this is a default value
                // assignment of a destructured variable
                !(
                  parent &&
                  parent.type === 'AssignmentPattern' &&
                  parent.right === child
                )
              ) {
                const { name } = child
                if (node.scopeIds && node.scopeIds.has(name)) {
                  return
                }
                if (name in knownIds) {
                  knownIds[name]++
                } else {
                  knownIds[name] = 1
                }
                ;(node.scopeIds || (node.scopeIds = new Set())).add(name)
              }
            }
          })
        )
      }
    },
    leave(node: Node & PrefixMeta) {
      if (node !== ast.body[0].expression && node.scopeIds) {
        node.scopeIds.forEach((id: string) => {
          knownIds[id]--
          if (knownIds[id] === 0) {
            delete knownIds[id]
          }
        })
      }
    }
  })

  // We break up the compound expression into an array of strings and sub
  // expressions (for identifiers that have been prefixed). In codegen, if
  // an ExpressionNode has the `.children` property, it will be used instead of
  // `.content`.
  const children: CompoundExpressionNode['children'] = []
  ids.sort((a, b) => a.start - b.start)
  ids.forEach((id, i) => {
    // range is offset by -1 due to the wrapping parens when parsed
    const start = id.start - 1
    const end = id.end - 1
    const last = ids[i - 1]
    const leadingText = rawExp.slice(last ? last.end - 1 : 0, start)
    if (leadingText.length || id.prefix) {
      children.push(leadingText + (id.prefix || ``))
    }
    const source = rawExp.slice(start, end)
    children.push(
      createSimpleExpression(
        id.name,
        false,
        {
          source,
          start: advancePositionWithClone(node.loc.start, source, start),
          end: advancePositionWithClone(node.loc.start, source, end)
        },
        id.isConstant /* isConstant */
      )
    )
    if (i === ids.length - 1 && end < rawExp.length) {
      children.push(rawExp.slice(end))
    }
  })

  let ret
  if (children.length) {
    ret = createCompoundExpression(children, node.loc)
  } else {
    ret = node
    ret.isConstant = !bailConstant
  }
  ret.identifiers = Object.keys(knownIds)
  return ret
}

