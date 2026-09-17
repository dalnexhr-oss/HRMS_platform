import { doc } from 'prettier';
import { printers as basePrinters } from 'prettier/plugins/estree';

export const printers = {
  estree: {
    ...basePrinters.estree,
    print(path, options, print, args) {
      const printed = basePrinters.estree.print(path, options, print, args);
      // Keep imports on one line without changing the width used for application code.
      // Hard line breaks required by comments are preserved by removeLines.
      return path.node.type === 'ImportDeclaration' ? doc.utils.removeLines(printed) : printed;
    },
  },
};
