public abstract class Item {
    int value;
    Move nextMove(){
        return new Move();
    }

    int getVal(){
        return value;
    }
}
