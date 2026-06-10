public class Runner {
    private static int gameSpeed = 500;
    private static int gameSize = 20;
    public Runner(){


    }
    public static void main(String[] args) throws InterruptedException {
        GameState g = new GameState(gameSize);
        g.setAll(new Food());
        g.set(new Creature(),(int)(Math.random() * 20),(int)(Math.random() * 20));
        g.set(new Creature(), (int)(Math.random() * 20), (int)(Math.random() * 20));
        System.out.println(g);

        for (int t = 0; t < 20; t++){
            Thread.sleep(gameSpeed);
            GameState nextTick = g.tick();
            System.out.println(nextTick);
            g = nextTick;
        }
    }
}
