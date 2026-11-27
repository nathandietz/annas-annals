const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Config, Parser } = require('html-validate');

const page = new Parser(Config.empty().resolve()).parseHtml(
  readFileSync(join(__dirname, '../../index.html'), 'utf8')
);

function matches(node, selector) {
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('[')) {
    const [, attribute, value] = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    const actual = node.getAttribute(attribute);
    return value === undefined ? actual !== null : actual === value;
  }
  return node.tagName === selector;
}

// Supply the template DOM operations used by app.js without duplicating markup.
function clone(source) {
  const attributes = new Map(source.attributes.map(({ key, value }) => [key, value ?? '']));
  let text = source.childNodes.filter(child => child.nodeName === '#text')
    .map(child => child.textContent).join('').trim();
  const node = {
    tagName: source.tagName,
    id: attributes.get('id') || '',
    hidden: attributes.has('hidden'),
    title: attributes.get('title') || '',
    className: attributes.get('class') || '',
    children: [],
    get firstElementChild() { return this.children[0]; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    addEventListener(type, handler) { this['on' + type] = handler; },
    append(...children) {
      for (const child of children) child.parent = this;
      this.children.push(...children);
    },
    remove() {
      this.parent.children = this.parent.children.filter(child => child !== this);
    },
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(matches(child, selector) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    classList: {
      contains(name) { return node.className.split(/\s+/).includes(name); },
      add(name) { if (!this.contains(name)) node.className = [node.className, name].filter(Boolean).join(' '); },
      remove(name) { node.className = node.className.split(/\s+/).filter(value => value !== name).join(' '); }
    }
  };
  node.append(...source.childElements.map(clone));
  return node;
}

function installTemplates(getElement) {
  for (const template of page.querySelectorAll('template')) {
    getElement(template.id).content = { cloneNode: () => clone(template) };
  }
}

module.exports = { installTemplates };
