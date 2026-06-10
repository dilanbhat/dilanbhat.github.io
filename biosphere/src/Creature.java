// Press Shift twice to open the Search Everywhere dialog and type `show whitespaces`,
// then press Enter. You can now see whitespace characters in your code.
public class Creature extends Item {

    public Creature(){
        super.value = 2;
    }


    @Override
    public Move nextMove(){
        double r1 = Math.random();
        double r2 =Math.random();
        Move m = new Move(((int)(r1 * 3) - 1), ((int)(r2 * 3) - 1));
        // m = new Move(0,1);
        System.out.println(m);
        return m;
    }

    @Override
    public String toString() {
        return "X";
    }


}