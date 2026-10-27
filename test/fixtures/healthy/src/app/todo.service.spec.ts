import { TodoService } from './todo.service';

describe('TodoService', () => {
  it('starts empty', () => expect(new TodoService().items()).toEqual([]));
});
