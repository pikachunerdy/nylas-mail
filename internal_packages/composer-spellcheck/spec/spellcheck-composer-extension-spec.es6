/* global waitsForPromise */

import fs from 'fs';
import path from 'path';

import SpellcheckComposerExtension from '../lib/spellcheck-composer-extension';
import {NylasSpellchecker, Message} from 'nylas-exports';

const initialPath = path.join(__dirname, 'fixtures', 'california-with-misspellings-before.html');
const initialHTML = fs.readFileSync(initialPath).toString();
const afterPath = path.join(__dirname, 'fixtures', 'california-with-misspellings-after.html');
const afterHTML = fs.readFileSync(afterPath).toString();

describe('SpellcheckComposerExtension', function spellcheckComposerExtension() {
  beforeEach(() => {
    // Avoid differences between node-spellcheck on different platforms
    const lookupPath = path.join(__dirname, 'fixtures', 'california-spelling-lookup.json');
    const spellings = JSON.parse(fs.readFileSync(lookupPath));
    spyOn(NylasSpellchecker, 'isMisspelled').andCallFake(word => spellings[word])
  });

  describe("update", () => {
    it("correctly walks a DOM tree and surrounds mispelled words", () => {
      const node = document.createElement('div');
      node.innerHTML = initialHTML;

      const editor = {
        rootNode: node,
        whilePreservingSelection: (cb) => cb(),
      };

      SpellcheckComposerExtension.update(editor);
      expect(node.innerHTML).toEqual(afterHTML);
    });
  });

  describe("applyTransformsForSending", () => {
    it("removes the spelling annotations it inserted", () => {
      const draft = new Message({ body: afterHTML });
      const fragment = document.createDocumentFragment();
      const draftBodyRootNode = document.createElement('root')
      fragment.appendChild(draftBodyRootNode)
      draftBodyRootNode.innerHTML = afterHTML
      SpellcheckComposerExtension.applyTransformsForSending({draftBodyRootNode, draft});
      expect(draftBodyRootNode.innerHTML).toEqual(initialHTML);
    });
  });
});
