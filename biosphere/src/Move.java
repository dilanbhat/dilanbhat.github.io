public class Move {
    private final int x; //-1, 0, or 1
    private final int y; //-1, 0, or 1

    public Move() {
        this.x = 0;
        this.y = 0;
    }

    public Move(int x, int y) {
        /*
        if (x != 0 && x!= 1 && x != -1) {
            throw new RuntimeException("x is " + Integer.toString(x) + ", which is invalid");
        }
        if (y != 0 && y!= 1 && y != -1) {
            throw new RuntimeException("y is " + Integer.toString(y) + ", which is invalid");
        }

         */
        this.x = x;
        this.y = y;
    }

    public int getY() {
        return y;
    }
    public int getX() {
        return x;
    }

    @Override
    public String toString() {
        return "X: " + x + " , Y: " + y;
    }
}
