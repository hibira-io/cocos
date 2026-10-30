// The part of the Cocos Creator 3.x 'cc' module this package uses, so tsc can
// check it outside the editor. The editor uses its own, complete types.
declare module 'cc' {
  export class Node {
    destroy(): boolean;
  }
  export class Component {
    node: Node;
  }
  export class Label extends Component {
    string: string;
  }
  export class EditBox extends Component {
    string: string;
  }
  export const director: { addPersistRootNode(node: Node): void };
  export const sys: { localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
  export const _decorator: {
    ccclass(name: string): ClassDecorator;
    property(options?: Record<string, unknown>): PropertyDecorator;
  };
}
