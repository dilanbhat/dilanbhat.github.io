public class GameState {
    private Item[][] field;
    private int size;



    public GameState(int size) {
        this.size = size;
        field = new Item[size][size];
    }

    public GameState(Item[][] startField) {
        this.size = startField.length;
        this.field = startField;
    }

    public GameState tick() {
        Item[][] newField = new GameState(size).setAll(new Empty()).getField();

        // Iterate through the 2D array
        for (int i = 0; i < field.length; i++) {
            for (int j = 0; j < field[i].length; j++) {
                //TODO update item
                Item currentItem = field[i][j];
                Move m = getValid(i, j, currentItem.nextMove());
                if(m.getY() == 2 && m.getX() == 0) {
                    //System.out.println("creature spot");
                }

                newField[m.getY()][m.getX()] = fight(currentItem, newField[m.getY()][m.getX()]);
                // Perform desired operations with the current item and location
            }
        }
        return new GameState(newField);
    }

    public Item fight(Item i1, Item i2){
        if(i1.getVal() == 2 || i1.getVal() == 2) {
            //System.out.println("hi");
        }
        if (i1.getVal() > i2.getVal()){
            return i1;
        }

        return i2;
    }

    public Move getValid (int y, int x, Move m) {
        //System.out.println("in: " + x + y);
        int newX = x + m.getX();
        int newY = y + m.getY();

        if (newX < 0 || newX >= size) {
            return new Move(x,y);
        }

        if (newY < 0 || newY >= size){
            return new Move(x,y);
        }

        //System.out.println("out: " + newX + newY);
        return new Move(newX, newY);
    }

    public GameState setAll(Item it){
        for (int i = 0; i < field.length; i++) {
            for (int j = 0; j < field[i].length; j++) {
                field[i][j] = it;
            }
        }
        return this;
    }

    public void set(Item it, int x, int y){
        field[y][x] = it;
    }


    public Item get(Item it, int x, int y) {
        return field[y][x];
    }

    public Item[][] getField() {
        return field;
    }

    @Override
    public String toString()
    {
        String out = "";
        for (int i = 0; i < field.length; i++) {
            for (int j = 0; j < field[i].length; j++) {
                Item currentItem = field[i][j];
                out += currentItem.toString();
            }
            out += "\n";
        }
        return out;
    }

}
