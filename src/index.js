/* eslint-disable no-use-before-define, no-restricted-syntax, no-await-in-loop */

/*
 * Copyright 2018 Schibsted.
 * Licensed under the MIT license. See LICENSE file in the project root for details.
 */

// libs
import flattenDeep from 'lodash/flattenDeep';
import isNil from 'lodash/isNil';
import last from 'lodash/last';
import omit from 'lodash/omit';
import pick from 'lodash/pick';

const isTextElement = (tag) =>
  typeof tag === 'string' || typeof tag === 'number';
const isTopLevelElement = (elementName) =>
  ['header', 'content', 'footer'].includes(elementName);

function updateContext(context, overrides) {
  return Object.assign(context, overrides);
}

function createContext(parentContext = {}) {
  return { ...parentContext };
}

function createElement(elementName, attributes, ...children) {
  const flatChildren = flattenDeep(children);
  return {
    elementName,
    children: flatChildren,
    attributes: attributes || {},
  };
}

function resolve(tag, context) {
  let resolvedTag = tag;
  while (resolvedTag && typeof resolvedTag.elementName === 'function') {
    resolvedTag = resolvedTag.elementName(
      { ...resolvedTag.attributes, children: resolvedTag.children },
      context,
      updateContext.bind(null, context),
    );
  }

  return resolvedTag;
}

function unwrapTextElements(elements) {
  if (elements.length === 1 && isTextElement(elements[0])) {
    return elements[0];
  }

  return elements;
}

function validateTag(resolvedTag, isTopLevel) {
  if (!resolvedTag) {
    return null;
  }

  if (isTextElement(resolvedTag)) {
    return resolvedTag;
  }

  const { elementName } = resolvedTag;

  if (!isTopLevel && isTopLevelElement(elementName)) {
    throw new Error(
      '<header>, <content> and <footer> elements can only appear as immediate descendents of the <document>',
    );
  }

  if (isTopLevel && !isTopLevelElement(elementName)) {
    throw new Error(
      `The <document> element can only contain <header>, <content>, and <footer> elements but found ${elementName}`,
    );
  }

  // eslint-disable-next-line unicorn/no-useless-undefined -- rule conflicts with `consistent-return`
  return undefined;
}

function appendChildToChildren(resolvedChild, resolvedChildren) {
  if (isTextElement(last(resolvedChildren)) && isTextElement(resolvedChild)) {
    // If the previous child is a string
    // and the next child is a string,
    // join them together.
    // eslint-disable-next-line no-param-reassign -- deliberate, this is much more performant
    resolvedChildren[resolvedChildren.length - 1] = `${
      resolvedChildren[resolvedChildren.length - 1]
    }${resolvedChild}`;
  } else if (!isNil(resolvedChild)) {
    // Otherwise push the child onto
    // the accumulator (as long as it's
    // not null or undefined).
    resolvedChildren.push(resolvedChild);
  }
}

/**
 * a variant of {@link resolveChildren} which does not support async components
 */
function resolveChildrenSync(tag, parentContext, isTopLevel) {
  const resolvedTag = resolve(tag, parentContext);

  if (resolvedTag instanceof Promise) {
    throw new TypeError(
      'Async components are not permitted in a synchronous context',
    );
  }

  const result = validateTag(resolvedTag, isTopLevel);
  if (result !== undefined) return result;

  const { children = [] } = resolvedTag;

  const resolvedChildren = [];

  for (const child of children) {
    const resolvedChild = resolveChildrenSync(
      child,
      createContext(parentContext),
      false,
    );

    appendChildToChildren(resolvedChild, resolvedChildren);
  }

  return resolveIntrinsicChildren(resolvedTag, resolvedChildren);
}

async function resolveChildren(tag, parentContext, isTopLevel) {
  const resolvedTag = await resolve(tag, parentContext);

  const result = validateTag(resolvedTag, isTopLevel);
  if (result !== undefined) return result;

  const { elementName, children = [], attributes } = resolvedTag;

  if (
    ['header', 'footer'].includes(elementName) &&
    children.length === 1 &&
    typeof children[0] === 'function'
  ) {
    return (...args) => ({
      stack: [
        resolveChildrenSync(children[0](...args), createContext(parentContext)),
      ],
      ...attributes,
    });
  }

  const resolvedChildren = [];

  for (const child of children) {
    const resolvedChild = await resolveChildren(
      await child,
      createContext(parentContext),
      false,
    );

    appendChildToChildren(resolvedChild, resolvedChildren);
  }

  return resolveIntrinsicChildren(resolvedTag, resolvedChildren);
}

function resolveIntrinsicChildren(resolvedTag, resolvedChildren) {
  const { elementName, attributes } = resolvedTag;

  /**
   * This is the meat. If you're in this file, you're probably looking for this.
   *
   * Converts the React-like syntax to something PDFMake understands.
   */
  switch (elementName) {
    case 'header':
    case 'content':
    case 'footer':
    case 'stack':
    case 'column':
    case 'cell':
      return { stack: resolvedChildren, ...attributes };
    case 'text':
      return {
        text: unwrapTextElements(resolvedChildren),
        ...attributes,
      };
    case 'columns':
      return { columns: resolvedChildren, ...attributes };
    case 'image':
      return { image: attributes.src, ...omit(attributes, 'src') };
    case 'svg':
      return { svg: attributes.content, ...omit(attributes, 'content') };
    case 'qr':
      return { qr: attributes.content, ...omit(attributes, 'content') };
    case 'table':
      return {
        table: {
          body: resolvedChildren,
          ...pick(attributes, ['headerRows', 'widths']),
        },
        ...omit(attributes, ['headerRows', 'widths']),
      };
    case 'row':
      return resolvedChildren;
    case 'ul':
      return { ul: resolvedChildren, ...attributes };
    case 'ol':
      return { ol: resolvedChildren, ...attributes };
    case 'document':
      throw new Error('<document> can only appear as the root element');
    default:
      return null;
  }
}

/*
 * Recursively traverse the JSON component tree created by the createElement calls,
 * resolving components from the bottom up.
 */
async function renderPdf(tag) {
  const context = createContext();
  const resolvedTag = await resolve(tag, context);
  const { children, elementName, attributes } = resolvedTag;

  if (elementName !== 'document') {
    throw new Error(
      `The root element must resolve to a <document>, actually resolved to ${elementName}`,
    );
  }

  const result = {};
  const isTopLevel = true;

  for (const child of children) {
    const resolvedChild = await resolve(await child, context);
    result[resolvedChild.elementName] = await resolveChildren(
      resolvedChild,
      context,
      isTopLevel,
    );
  }

  return {
    ...result,
    ...attributes,
  };
}

const Fragment = (props) => createElement('stack', null, props.children);

export default {
  createElement,
  renderPdf,
  Fragment,
};
