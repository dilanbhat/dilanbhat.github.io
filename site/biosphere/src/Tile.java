import java.util.ArrayList;

public class Tile {
    private ArrayList<Item> items;

    public Tile(){
        items = new ArrayList<Item>();
    }

    public void add(Item it) {
        items.add(it);
    }

    public ArrayList<Item> getItems(){
        return items;
    }


}
